import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCurrentAccessContext } from "@/access/server";
import { requireCsrfProtection } from "@/auth/csrf";
import { db } from "@/db";
import {
	accountDeletionRequests,
	appProductEntitlements,
	processingJobs,
	profiles,
	whopAccountLinks,
} from "@/db/schema";
import { webEnv } from "@/env/web";

export async function GET() {
	const context = await getCurrentAccessContext();
	if (!context)
		return NextResponse.json({ code: "unauthenticated" }, { status: 401 });
	const [request] = await db
		.select({
			status: accountDeletionRequests.status,
			requestedAt: accountDeletionRequests.requestedAt,
			completedAt: accountDeletionRequests.completedAt,
			safeFailureCode: accountDeletionRequests.safeFailureCode,
		})
		.from(accountDeletionRequests)
		.where(eq(accountDeletionRequests.userId, context.userId))
		.limit(1);
	return NextResponse.json(request ?? { status: "not_requested" });
}

export async function POST(request: Request) {
	const csrf = requireCsrfProtection(request);
	if (csrf) return csrf;
	if (webEnv.ENABLE_ACCOUNT_DELETION !== "true")
		return NextResponse.json(
			{ code: "account_deletion_disabled" },
			{ status: 503 },
		);
	const context = await getCurrentAccessContext();
	if (!context)
		return NextResponse.json({ code: "unauthenticated" }, { status: 401 });
	if (
		!context.lastAuthenticatedAt ||
		Date.now() - context.lastAuthenticatedAt.getTime() >
			webEnv.ACCOUNT_DELETION_RECENT_AUTH_SECONDS * 1_000
	)
		return NextResponse.json(
			{ code: "recent_authentication_required" },
			{ status: 403 },
		);
	const body: unknown = await request.json().catch(() => null);
	if (
		!body ||
		typeof body !== "object" ||
		Reflect.get(body, "confirmation") !== "DELETE MY ACCOUNT"
	)
		return NextResponse.json(
			{ code: "confirmation_required" },
			{ status: 400 },
		);
	await db.transaction(async (tx) => {
		await tx
			.insert(accountDeletionRequests)
			.values({
				userId: context.userId,
				status: "requested",
				updatedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: accountDeletionRequests.userId,
				set: {
					status: "requested",
					safeFailureCode: null,
					updatedAt: new Date(),
				},
			});
		await tx
			.update(profiles)
			.set({
				accountStatus: "deletion_scheduled",
				scheduledDeletionAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(profiles.userId, context.userId));
		await tx
			.update(appProductEntitlements)
			.set({
				status: "revoked",
				revokedAt: new Date(),
				reason: "account_deletion",
				updatedAt: new Date(),
			})
			.where(eq(appProductEntitlements.userId, context.userId));
		await tx
			.update(whopAccountLinks)
			.set({ entitlementState: "revoked", updatedAt: new Date() })
			.where(eq(whopAccountLinks.userId, context.userId));
		await tx
			.update(processingJobs)
			.set({
				status: "cancel_requested",
				cancelReason: "account_deletion",
				cancelRequestedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(processingJobs.ownerUserId, context.userId),
					inArray(processingJobs.status, [
						"queued",
						"claimed",
						"running",
						"retry_wait",
					]),
				),
			);
	});
	return NextResponse.json({ status: "requested" }, { status: 202 });
}
