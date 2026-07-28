import { and, count, eq, sql } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { getCurrentAccessContext } from "@/access/server";
import { db } from "@/db";
import {
	appProductEntitlements,
	profiles,
	whopAccountLinks,
} from "@/db/schema";
import { webEnv } from "@/env/web";
import { readOAuthState, WHOP_OAUTH_COOKIE } from "@/whop/oauth";

export async function GET(request: NextRequest) {
	const destination = new URL("/clipper", webEnv.NEXT_PUBLIC_SITE_URL);
	const fail = (code: string) => {
		destination.searchParams.set("access", code);
		const response = NextResponse.redirect(destination);
		response.cookies.delete(WHOP_OAUTH_COOKIE);
		return response;
	};
	const context = await getCurrentAccessContext();
	const state = readOAuthState(request.cookies.get(WHOP_OAUTH_COOKIE)?.value);
	if (!context || !state || state.userId !== context.userId)
		return fail("link_invalid");
	if (request.nextUrl.searchParams.get("state") !== state.state)
		return fail("link_invalid");
	const code = request.nextUrl.searchParams.get("code");
	if (
		!code ||
		!webEnv.WHOP_APP_ID ||
		!webEnv.WHOP_API_KEY ||
		!webEnv.WHOP_PRODUCT_ID
	)
		return fail("link_unavailable");
	const redirectUri = new URL(
		"/api/whop/link/callback",
		webEnv.NEXT_PUBLIC_SITE_URL,
	).toString();
	try {
		const tokenResponse = await fetch("https://api.whop.com/oauth/token", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				grant_type: "authorization_code",
				code,
				redirect_uri: redirectUri,
				client_id: webEnv.WHOP_APP_ID,
				code_verifier: state.verifier,
			}),
			signal: AbortSignal.timeout(8_000),
		});
		if (!tokenResponse.ok) return fail("link_invalid");
		const tokens: unknown = await tokenResponse.json();
		const accessToken =
			tokens && typeof tokens === "object"
				? Reflect.get(tokens, "access_token")
				: null;
		const refreshToken =
			tokens && typeof tokens === "object"
				? Reflect.get(tokens, "refresh_token")
				: null;
		if (typeof accessToken !== "string" || !accessToken)
			return fail("link_invalid");
		const userResponse = await fetch("https://api.whop.com/oauth/userinfo", {
			headers: { Authorization: `Bearer ${accessToken}` },
			signal: AbortSignal.timeout(8_000),
		});
		const user: unknown = await userResponse.json();
		const subject =
			user && typeof user === "object" ? Reflect.get(user, "sub") : null;
		if (
			!userResponse.ok ||
			typeof subject !== "string" ||
			!subject.startsWith("user_")
		)
			return fail("link_invalid");
		const whopUserId = subject;
		const accessResponse = await fetch(
			`https://api.whop.com/api/v1/users/${encodeURIComponent(whopUserId)}/access/${encodeURIComponent(webEnv.WHOP_PRODUCT_ID)}`,
			{
				headers: { Authorization: `Bearer ${webEnv.WHOP_API_KEY}` },
				signal: AbortSignal.timeout(8_000),
			},
		);
		const access: unknown = await accessResponse.json();
		if (
			!accessResponse.ok ||
			!access ||
			typeof access !== "object" ||
			Reflect.get(access, "has_access") !== true
		)
			return fail("no_entitlement");
		const allowlist = new Set(
			(webEnv.PRIVATE_BETA_ALLOWLIST ?? "")
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean),
		);
		const bypassBetaCap =
			context.isAdmin ||
			allowlist.has(context.userId) ||
			Boolean(context.email && allowlist.has(context.email));
		await db.transaction(async (tx) => {
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtext('private_beta_admission'))`,
			);
			const [conflict] = await tx
				.select({ userId: whopAccountLinks.userId })
				.from(whopAccountLinks)
				.where(eq(whopAccountLinks.whopUserId, whopUserId))
				.limit(1);
			if (conflict && conflict.userId !== context.userId)
				throw new Error("whop_account_already_linked");
			if (!conflict && !bypassBetaCap && webEnv.PRIVATE_BETA_MAX_USERS > 0) {
				const [active] = await tx
					.select({ total: count() })
					.from(whopAccountLinks)
					.where(eq(whopAccountLinks.entitlementState, "active"));
				if (Number(active?.total ?? 0) >= webEnv.PRIVATE_BETA_MAX_USERS)
					throw new Error("private_beta_capacity_reached");
			}
			await tx
				.insert(whopAccountLinks)
				.values({
					userId: context.userId,
					whopUserId,
					productId: webEnv.WHOP_PRODUCT_ID!,
					entitlementState: "active",
					lastVerifiedAt: new Date(),
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: whopAccountLinks.userId,
					set: {
						whopUserId,
						productId: webEnv.WHOP_PRODUCT_ID!,
						entitlementState: "active",
						lastVerifiedAt: new Date(),
						updatedAt: new Date(),
					},
				});
			await tx
				.insert(appProductEntitlements)
				.values({
					userId: context.userId,
					productId: "clipper",
					status: "granted",
					reason: "whop_oauth_verified",
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [
						appProductEntitlements.userId,
						appProductEntitlements.productId,
					],
					set: {
						status: "granted",
						reason: "whop_oauth_verified",
						revokedAt: null,
						updatedAt: new Date(),
					},
				});
			await tx
				.update(profiles)
				.set({
					productAccessStatus: "approved",
					productAccessUpdatedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(profiles.userId, context.userId),
						eq(profiles.accountStatus, "active"),
					),
				);
		});
		if (typeof refreshToken === "string" && refreshToken) {
			await fetch("https://api.whop.com/oauth/revoke", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					token: refreshToken,
					client_id: webEnv.WHOP_APP_ID,
				}),
				signal: AbortSignal.timeout(5_000),
			}).catch(() => undefined);
		}
		return fail("linked");
	} catch (error) {
		if (
			error instanceof Error &&
			error.message === "private_beta_capacity_reached"
		)
			return fail("beta_capacity_reached");
		return fail("link_unavailable");
	}
}
