import "server-only";

import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import {
	dedicatedWorkerProvisioningJobs,
	planEntitlements,
	subscriptions,
} from "@/db/schema";
import { getDedicatedWorkerProvisioningAdapter } from "./worker-provisioning";

export async function hasActivePlanEntitlement({
	userId,
	entitlementKey,
}: {
	userId: string;
	entitlementKey: "free" | "private_server" | "no_ads" | "private_worker";
}) {
	const now = new Date();
	const [row] = await db
		.select({ key: planEntitlements.entitlementKey })
		.from(planEntitlements)
		.where(
			and(
				eq(planEntitlements.userId, userId),
				eq(planEntitlements.entitlementKey, entitlementKey),
				eq(planEntitlements.status, "active"),
				or(isNull(planEntitlements.expiresAt), gt(planEntitlements.expiresAt, now)),
			),
		)
		.limit(1);
	return Boolean(row);
}

export async function getBillingOverview(userId: string) {
	const [entitlements, activeSubscriptions, workerJobs] = await Promise.all([
		db
			.select()
			.from(planEntitlements)
			.where(eq(planEntitlements.userId, userId)),
		db
			.select()
			.from(subscriptions)
			.where(eq(subscriptions.userId, userId)),
		db
			.select()
			.from(dedicatedWorkerProvisioningJobs)
			.where(eq(dedicatedWorkerProvisioningJobs.userId, userId)),
	]);
	return { entitlements, subscriptions: activeSubscriptions, workerJobs };
}

export async function shouldShowAdsForUser(userId: string | null | undefined) {
	if (!userId) return true;
	return !(await hasActivePlanEntitlement({
		userId,
		entitlementKey: "no_ads",
	}));
}

export async function ensureDedicatedWorkerProvisioningJob({
	userId,
	subscriptionId,
}: {
	userId: string;
	subscriptionId: string;
}) {
	const adapter = getDedicatedWorkerProvisioningAdapter();
	const provision = await adapter.requestProvisioning({ userId, subscriptionId });
	await db
		.insert(dedicatedWorkerProvisioningJobs)
		.values({
			userId,
			subscriptionId,
			state: provision.state,
			adapter: adapter.name,
			workerAssignment: provision.workerAssignment,
			lastError: provision.lastError ?? null,
			updatedAt: new Date(),
		})
		.onConflictDoNothing();
}

export const ensureManualProvisioningJob = ensureDedicatedWorkerProvisioningJob;

export async function markDedicatedWorkerDeprovisioning({
	userId,
	subscriptionId,
}: {
	userId: string;
	subscriptionId: string;
}) {
	const adapter = getDedicatedWorkerProvisioningAdapter();
	const deprovision = await adapter.requestDeprovisioning({ userId, subscriptionId });
	await db
		.update(dedicatedWorkerProvisioningJobs)
		.set({
			state: deprovision.state,
			adapter: adapter.name,
			workerAssignment: deprovision.workerAssignment,
			lastError: deprovision.lastError ?? null,
			cancelledAt: new Date(),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(dedicatedWorkerProvisioningJobs.userId, userId),
				eq(dedicatedWorkerProvisioningJobs.subscriptionId, subscriptionId),
				inArray(dedicatedWorkerProvisioningJobs.state, [
					"pending",
					"provisioning",
					"active",
				]),
			),
		);
}

export async function getDedicatedWorkerRoutingForUser(userId: string) {
	const allowed = await hasActivePlanEntitlement({
		userId,
		entitlementKey: "private_worker",
	});
	if (!allowed) return null;
	const [job] = await db
		.select({
			id: dedicatedWorkerProvisioningJobs.id,
			workerAssignment: dedicatedWorkerProvisioningJobs.workerAssignment,
		})
		.from(dedicatedWorkerProvisioningJobs)
		.where(
			and(
				eq(dedicatedWorkerProvisioningJobs.userId, userId),
				eq(dedicatedWorkerProvisioningJobs.state, "active"),
			),
		)
		.limit(1);
	return job ?? null;
}
