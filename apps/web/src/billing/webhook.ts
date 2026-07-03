import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { donations, paymentEvents } from "@/db/schema";
import { recordProductEvent } from "@/product-events/ledger";
import { validateRazorpayAmount } from "./razorpay-validation";

type RazorpayPayload = {
	event?: string;
	created_at?: number;
	payload?: {
		payment?: { entity?: Record<string, unknown> };
		order?: { entity?: Record<string, unknown> };
	};
};

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object") return {};
	return Object.fromEntries(Object.entries(value));
}

function parseRazorpayPayload({ value }: { value: unknown }): RazorpayPayload {
	const record = asRecord(value);
	const rawPayload = asRecord(record.payload);
	return {
		event: stringValue({ value: record.event }) ?? undefined,
		created_at: typeof record.created_at === "number" ? record.created_at : undefined,
		payload: {
			payment: { entity: asRecord(asRecord(rawPayload.payment).entity) },
			order: { entity: asRecord(asRecord(rawPayload.order).entity) },
		},
	};
}

function stringValue({ value }: { value: unknown }) {
	return typeof value === "string" ? value : null;
}

function eventId({ payload }: { payload: RazorpayPayload }) {
	const payment = asRecord(payload.payload?.payment?.entity);
	const order = asRecord(payload.payload?.order?.entity);
	return (
		stringValue({ value: payment.id }) ||
		stringValue({ value: order.id }) ||
		`${payload.event ?? "unknown"}:${payload.created_at ?? Date.now()}`
	);
}

export async function processRazorpayWebhook({
	rawPayload,
	providerEventId: providerEventIdHeader,
}: {
	rawPayload: unknown;
	providerEventId?: string | null;
}) {
	const payload = parseRazorpayPayload({ value: rawPayload });
	const eventType = payload.event ?? "unknown";
	const providerEventId = providerEventIdHeader
		? `event:${providerEventIdHeader}`
		: `${eventType}:${eventId({ payload })}`;
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
		if (
			eventType === "payment.captured" ||
			eventType === "payment.authorized" ||
			eventType === "order.paid"
		) {
			await processDonationEvent({ payload });
		}
		if (eventType === "payment.failed") {
			await processFailedDonationPaymentEvent({ payload });
		}
		if (eventType.startsWith("refund.")) {
			await processRefundEvent({ payload });
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

async function processDonationEvent({ payload }: { payload: RazorpayPayload }) {
	const payment = asRecord(payload.payload?.payment?.entity);
	const order = asRecord(payload.payload?.order?.entity);
	const providerOrderId =
		stringValue({ value: payment.order_id }) || stringValue({ value: order.id });
	if (!providerOrderId) return;
	const [donation] = await db
		.select({
			id: donations.id,
			userId: donations.userId,
			amountInr: donations.amountInr,
			currency: donations.currency,
			status: donations.status,
		})
		.from(donations)
		.where(eq(donations.providerOrderId, providerOrderId))
		.limit(1);
	if (!donation || donation.status === "refunded") return;
	const amount = typeof payment.amount === "number" ? payment.amount : order.amount;
	const currency =
		stringValue({ value: payment.currency }) ?? stringValue({ value: order.currency });
	const amountValidation = validateRazorpayAmount({
		amount,
		currency,
		expectedAmountPaise: donation.amountInr * 100,
	});
	if (!amountValidation.valid) {
		throw new Error(`razorpay_donation_${amountValidation.reason}`);
	}
	const paymentStatus = stringValue({ value: payment.status });
	const captured =
		payload.event === "order.paid" ||
		payload.event === "payment.captured" ||
		paymentStatus === "captured" ||
		payment.captured === true;
	if (!captured) return;
	await db
		.update(donations)
		.set({
			status: "paid",
			providerPaymentId: stringValue({ value: payment.id }),
			verifiedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(eq(donations.id, donation.id));
	await recordDonationProductEvent({
		eventName: "donation_completed",
		donationId: donation.id,
		userId: donation.userId,
		metadata: {
			amountInr: donation.amountInr,
			currency: donation.currency,
			source: "razorpay_webhook",
		},
	});
}

async function processFailedDonationPaymentEvent({
	payload,
}: {
	payload: RazorpayPayload;
}) {
	const payment = asRecord(payload.payload?.payment?.entity);
	const providerOrderId = stringValue({ value: payment.order_id });
	if (!providerOrderId) return;
	const [donation] = await db
		.select({ id: donations.id, userId: donations.userId })
		.from(donations)
		.where(eq(donations.providerOrderId, providerOrderId))
		.limit(1);
	await db
		.update(donations)
		.set({ status: "failed", updatedAt: new Date() })
		.where(
			sql`${donations.providerOrderId} = ${providerOrderId} and ${donations.status} not in ('paid','refunded')`,
		);
	if (donation) {
		await recordDonationProductEvent({
			eventName: "donation_failed",
			donationId: donation.id,
			userId: donation.userId,
			metadata: { source: "razorpay_webhook" },
		});
	}
}

async function processRefundEvent({ payload }: { payload: RazorpayPayload }) {
	const payment = asRecord(payload.payload?.payment?.entity);
	const providerPaymentId = stringValue({ value: payment.id });
	if (!providerPaymentId) return;
	const [donation] = await db
		.select({ id: donations.id, userId: donations.userId })
		.from(donations)
		.where(eq(donations.providerPaymentId, providerPaymentId))
		.limit(1);
	await db
		.update(donations)
		.set({ status: "refunded", updatedAt: new Date() })
		.where(eq(donations.providerPaymentId, providerPaymentId));
	if (donation) {
		await recordDonationProductEvent({
			eventName: "donation_refunded",
			donationId: donation.id,
			userId: donation.userId,
			metadata: { source: "razorpay_webhook" },
		});
	}
}

async function recordDonationProductEvent({
	eventName,
	donationId,
	userId,
	metadata,
}: {
	eventName: "donation_completed" | "donation_failed" | "donation_refunded";
	donationId: string;
	userId: string | null;
	metadata: Record<string, unknown>;
}) {
	try {
		await recordProductEvent({
			eventName,
			eventKey: `${eventName}:${donationId}`,
			userId,
			metadata: {
				...metadata,
				donationId,
			},
		});
	} catch (error) {
		console.error("product_event_record_failed", {
			eventName,
			errorName: error instanceof Error ? error.name : "UnknownError",
		});
	}
}
