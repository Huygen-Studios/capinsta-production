import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireCsrfProtection } from "@/auth/csrf";
import { checkRateLimit } from "@/auth/rate-limit";
import { createDonationOrder, razorpayPublicConfig } from "@/billing/razorpay";
import { findDonationTier, findDonationTierByAmount } from "@/billing/plans";
import { sanitizeDonationText } from "@/billing/razorpay-validation";
import { db } from "@/db";
import { donations } from "@/db/schema";
import { createClient } from "@/lib/supabase/server";

const donationSchema = z.object({
	donationTierId: z.string().trim().min(1).max(80).optional(),
	amountInr: z.number().int().optional(),
	donorName: z.string().trim().max(80).optional(),
	donorMessage: z.string().trim().max(240).optional(),
	anonymous: z.boolean().default(false),
	receiptEmail: z.email().optional(),
});

export async function POST(request: NextRequest) {
	const csrf = requireCsrfProtection(request);
	if (csrf) return csrf;
	const { limited } = await checkRateLimit({ request });
	if (limited) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

	const body = await request.json().catch(() => null);
	const result = donationSchema.safeParse(body);
	if (!result.success) {
		return NextResponse.json(
			{ error: "Please select a valid donation amount.", details: result.error.flatten().fieldErrors },
			{ status: 400 },
		);
	}
	const tier = result.data.donationTierId
		? findDonationTier(result.data.donationTierId)
		: typeof result.data.amountInr === "number"
			? findDonationTierByAmount(result.data.amountInr)
			: null;
	if (!tier) {
		return NextResponse.json(
			{ error: "Please select a valid donation amount." },
			{ status: 400 },
		);
	}
	if (!result.data.anonymous && !result.data.donorName?.trim()) {
		return NextResponse.json(
			{ error: "Enter a donor name or choose Donate anonymously." },
			{ status: 400 },
		);
	}

	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();

	try {
		const donorName = result.data.anonymous
			? null
			: sanitizeDonationText({ value: result.data.donorName, maxLength: 80 });
		const donorMessage = sanitizeDonationText({
			value: result.data.donorMessage,
			maxLength: 240,
		});
		const [donation] = await db
			.insert(donations)
			.values({
				userId: user?.id ?? null,
				amountInr: tier.amountInr,
				donorName,
				donorMessage,
				anonymous: result.data.anonymous,
				receiptEmail: result.data.receiptEmail ?? user?.email ?? null,
			})
			.returning();
		const order = await createDonationOrder({
			amountPaise: tier.amountPaise,
			receipt: donation.id,
			notes: {
				internal_donation_id: donation.id,
				donation_tier_id: tier.id,
				payment_type: "donation",
				environment: process.env.PAYMENT_ENVIRONMENT ?? "test",
			},
		});
		await db
			.update(donations)
			.set({ providerOrderId: order.id, updatedAt: new Date() })
			.where(eq(donations.id, donation.id));
		const publicConfig = razorpayPublicConfig();
		if (!publicConfig) throw new Error("razorpay_not_configured");
		return NextResponse.json({
			keyId: publicConfig.keyId,
			orderId: order.id,
			amount: order.amount,
			currency: order.currency,
			donationId: donation.id,
			tierLabel: tier.label,
			checkoutName: "Capinsta",
			checkoutDescription: `Donation: ${tier.label} ${tier.title}`,
		});
	} catch (error) {
		console.error("donation_checkout_failed", {
			error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
		});
		return NextResponse.json(
			{ error: "Payments are temporarily unavailable. Please try again later." },
			{ status: 503 },
		);
	}
}
