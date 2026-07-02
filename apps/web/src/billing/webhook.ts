import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
	donations,
	paymentEvents,
	planEntitlements,
	subscriptions,
} from "@/db/schema";
import { webEnv } from "@/env/web";
import { PRIVATE_SERVER_PRICE_INR } from "./plans";
import {
	validatePrivateServerSubscriptionEntity,
	validateRazorpayAmount,
} from "./razorpay-validation";
import {
	ensureDedicatedWorkerProvisioningJob,
	markDedicatedWorkerDeprovisioning,
} from "./entitlements";

type RazorpayPayload = {
	event?: string;
	created_at?: number;
	payload?: {
		subscription?: { entity?: Record<string, unknown> };
		payment?: { entity?: Record<string, unknown> };
		order?: { entity?: Record<string, unknown> };
	};
};

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object") return {};
	return Object.fromEntries(Object.entries(value));
}

function parseRazorpayPayload(value: unknown): RazorpayPayload {
	const record = asRecord(value);
	const rawPayload = asRecord(record.payload);
	return {
		event: stringValue(record.event) ?? undefined,
		created_at: typeof record.created_at === "number" ? record.created_at : undefined,
		payload: {
			subscription: { entity: asRecord(asRecord(rawPayload.subscription).entity) },
			payment: { entity: asRecord(asRecord(rawPayload.payment).entity) },
			order: { entity: asRecord(asRecord(rawPayload.order).entity) },
		},
	};
}

function stringValue(value: unknown) {
	return typeof value === "string" ? value : null;
}

function numberDate(value: unknown) {
	return typeof value === "number" ? new Date(value * 1000) : null;
}

function eventId(payload: RazorpayPayload) {
	const payment = asRecord(payload.payload?.payment?.entity);
	const subscription = asRecord(payload.payload?.subscription?.entity);
	const order = asRecord(payload.payload?.order?.entity);
	return (
		stringValue(payment.id) ||
		stringValue(subscription.id) ||
		stringValue(order.id) ||
		`${payload.event ?? "unknown"}:${payload.created_at ?? Date.now()}`
	);
}

function isTerminalStatus(status: string | null | undefined) {
	return (
		status === "cancelled" ||
		status === "halted" ||
		status === "expired" ||
		status === "completed" ||
		status === "failed"
	);
}

export async function processRazorpayWebhook(rawPayload: unknown) {
	const payload = parseRazorpayPayload(rawPayload);
	const eventType = payload.event ?? "unknown";
	const providerEventId = `${eventType}:${eventId(payload)}`;
	const [existing] = await db
		.select({ id: paymentEvents.id, status: paymentEvents.processingStatus })
		.from(paymentEvents)
		.where(eq(paymentEvents.providerEventId, providerEventId))
		.limit(1);
	if (existing?.status === "processed") return { replay: true };

	const [paymentEvent] = await db
		.insert(paymentEvents)
		.values({
			provider: "razorpay",
			providerEventId,
			eventType,
			signatureValid: true,
			payload: payload as Record<string, unknown>,
		})
		.onConflictDoUpdate({
			target: [paymentEvents.provider, paymentEvents.providerEventId],
			set: { payload: payload as Record<string, unknown> },
		})
		.returning();

	try {
		if (eventType.startsWith("subscription.")) {
			await processSubscriptionEvent(payload);
		}
		if (eventType === "payment.captured" || eventType === "order.paid") {
			await processDonationEvent(payload);
		}
		if (eventType === "payment.failed") {
			await processFailedPaymentEvent(payload);
		}
		await db
			.update(paymentEvents)
			.set({ processingStatus: "processed", processedAt: new Date() })
			.where(eq(paymentEvents.id, paymentEvent.id));
		return { replay: false };
	} catch (error) {
		await db
			.update(paymentEvents)
			.set({
				processingStatus: "failed",
				processingError: error instanceof Error ? error.message.slice(0, 300) : "unknown",
			})
			.where(eq(paymentEvents.id, paymentEvent.id));
		throw error;
	}
}

async function processSubscriptionEvent(payload: RazorpayPayload) {
	const entity = asRecord(payload.payload?.subscription?.entity);
	const validation = validatePrivateServerSubscriptionEntity({
		entity,
		expectedPlanId: webEnv.RAZORPAY_PRIVATE_SERVER_PLAN_ID,
	});
	if (!validation.valid) throw new Error(`razorpay_subscription_${validation.reason}`);
	const providerSubscriptionId = stringValue(entity.id);
	const userId = stringValue(asRecord(entity.notes).capinsta_user_id);
	if (!providerSubscriptionId || !userId) return;
	const status = stringValue(entity.status) ?? "pending";
	const active = status === "active" || status === "authenticated";
	const terminal = isTerminalStatus(status);

	const [existingSubscription] = await db
		.select()
		.from(subscriptions)
		.where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId))
		.limit(1);
	if (existingSubscription && existingSubscription.userId !== userId) {
		throw new Error("razorpay_subscription_user_mismatch");
	}
	if (existingSubscription && isTerminalStatus(existingSubscription.status) && active) {
		return;
	}

	const [subscription] = await db
		.insert(subscriptions)
		.values({
			userId,
			providerSubscriptionId,
			providerPlanId: stringValue(entity.plan_id),
			planKey: "private_server",
			status,
			amountInr: PRIVATE_SERVER_PRICE_INR,
			currentPeriodStart: numberDate(entity.current_start),
			currentPeriodEnd: numberDate(entity.current_end),
			cancelledAt: terminal ? new Date() : null,
			metadata: entity,
			updatedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: subscriptions.providerSubscriptionId,
			set: {
				status,
				currentPeriodStart: numberDate(entity.current_start),
				currentPeriodEnd: numberDate(entity.current_end),
				cancelledAt: terminal ? new Date() : null,
				metadata: entity,
				updatedAt: new Date(),
			},
		})
		.returning();

	if (active) {
		for (const entitlementKey of ["private_server", "no_ads", "private_worker"] as const) {
			await db
				.insert(planEntitlements)
				.values({
					userId,
					entitlementKey,
					status: "active",
					source: "razorpay_subscription",
					subscriptionId: subscription.id,
					metadata: { providerSubscriptionId },
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [planEntitlements.userId, planEntitlements.entitlementKey],
					set: {
						status: "active",
						subscriptionId: subscription.id,
						metadata: { providerSubscriptionId },
						updatedAt: new Date(),
					},
				});
		}
		await ensureDedicatedWorkerProvisioningJob({ userId, subscriptionId: subscription.id });
	}

	if (terminal) {
		await suspendPaidEntitlements(userId);
		await markDedicatedWorkerDeprovisioning({ userId, subscriptionId: subscription.id });
	}
}

async function processDonationEvent(payload: RazorpayPayload) {
	const payment = asRecord(payload.payload?.payment?.entity);
	const order = asRecord(payload.payload?.order?.entity);
	const providerOrderId = stringValue(payment.order_id) || stringValue(order.id);
	if (!providerOrderId) return;
	const [donation] = await db
		.select({
			id: donations.id,
			amountInr: donations.amountInr,
			currency: donations.currency,
		})
		.from(donations)
		.where(eq(donations.providerOrderId, providerOrderId))
		.limit(1);
	if (!donation) return;
	const amount = typeof payment.amount === "number" ? payment.amount : order.amount;
	const currency = stringValue(payment.currency) ?? stringValue(order.currency);
	const amountValidation = validateRazorpayAmount({
		amount,
		currency,
		expectedAmountPaise: donation.amountInr * 100,
	});
	if (!amountValidation.valid) {
		throw new Error(`razorpay_donation_${amountValidation.reason}`);
	}
	await db
		.update(donations)
		.set({
			status: "paid",
			providerPaymentId: stringValue(payment.id),
			verifiedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(eq(donations.id, donation.id));
}

async function processFailedPaymentEvent(payload: RazorpayPayload) {
	const payment = asRecord(payload.payload?.payment?.entity);
	const providerSubscriptionId = stringValue(payment.subscription_id);
	const providerOrderId = stringValue(payment.order_id);
	if (providerSubscriptionId) {
		const [subscription] = await db
			.select()
			.from(subscriptions)
			.where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId))
			.limit(1);
		if (subscription) {
			await db
				.update(subscriptions)
				.set({ status: "failed", updatedAt: new Date() })
				.where(eq(subscriptions.id, subscription.id));
			await suspendPaidEntitlements(subscription.userId);
			await markDedicatedWorkerDeprovisioning({
				userId: subscription.userId,
				subscriptionId: subscription.id,
			});
		}
	}
	if (providerOrderId) {
		await db
			.update(donations)
			.set({ status: "failed", updatedAt: new Date() })
			.where(eq(donations.providerOrderId, providerOrderId));
	}
}

async function suspendPaidEntitlements(userId: string) {
	await db
		.update(planEntitlements)
		.set({ status: "cancelled", updatedAt: new Date() })
		.where(
			sql`${planEntitlements.userId} = ${userId} and ${planEntitlements.entitlementKey} in ('private_server','no_ads','private_worker')`,
		);
}
