import { NextResponse, type NextRequest } from "next/server";
import { requireCsrfProtection } from "@/auth/csrf";
import { checkRateLimit } from "@/auth/rate-limit";
import { PRIVATE_SERVER_PRICE_INR } from "@/billing/plans";
import { createPrivateServerSubscription, razorpayPublicConfig } from "@/billing/razorpay";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { webEnv } from "@/env/web";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
	const csrf = requireCsrfProtection(request);
	if (csrf) return csrf;
	const { limited } = await checkRateLimit({ request });
	if (limited) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

	const supabase = await createClient();
	const {
		data: { user },
		error,
	} = await supabase.auth.getUser();
	if (error || !user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

	try {
		const subscription = await createPrivateServerSubscription({
			userId: user.id,
			email: user.email ?? null,
		});
		await db
			.insert(subscriptions)
			.values({
				userId: user.id,
				providerSubscriptionId: subscription.id,
				providerPlanId: webEnv.RAZORPAY_PRIVATE_SERVER_PLAN_ID,
				planKey: "private_server",
				status: subscription.status,
				amountInr: PRIVATE_SERVER_PRICE_INR,
				metadata: {
					checkoutCreatedAt: new Date().toISOString(),
					shortUrl: subscription.short_url ?? null,
				},
				updatedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: subscriptions.providerSubscriptionId,
				set: {
					status: subscription.status,
					metadata: {
						checkoutCreatedAt: new Date().toISOString(),
						shortUrl: subscription.short_url ?? null,
					},
					updatedAt: new Date(),
				},
			});
		const publicConfig = razorpayPublicConfig();
		if (!publicConfig) throw new Error("razorpay_not_configured");
		return NextResponse.json({
			keyId: publicConfig.keyId,
			subscriptionId: subscription.id,
			shortUrl: subscription.short_url ?? null,
			status: subscription.status,
		});
	} catch (checkoutError) {
		console.error("private_server_checkout_failed", {
			error:
				checkoutError instanceof Error
					? checkoutError.message.slice(0, 200)
					: "unknown",
		});
		return NextResponse.json(
			{ error: "Private Server checkout is unavailable. Please try again later." },
			{ status: 503 },
		);
	}
}
