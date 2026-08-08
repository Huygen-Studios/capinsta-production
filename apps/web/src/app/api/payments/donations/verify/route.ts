import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireCsrfProtection } from "@/auth/csrf";
import {
	fetchRazorpayPayment,
	verifyRazorpayOrderPaymentSignature,
} from "@/billing/razorpay";
import { validateRazorpayAmount } from "@/billing/razorpay-validation";
import { db } from "@/db";
import { donations } from "@/db/schema";

const verifySchema = z.object({
	donationId: z.uuid(),
	razorpayPaymentId: z.string().trim().min(1).max(120),
	razorpayOrderId: z.string().trim().min(1).max(120),
	razorpaySignature: z.string().trim().min(32).max(256),
});

export async function POST(request: NextRequest) {
	const csrf = requireCsrfProtection(request);
	if (csrf) return csrf;

	const body = await request.json().catch(() => null);
	const result = verifySchema.safeParse(body);
	if (!result.success) {
		return NextResponse.json({ error: "Payment verification failed." }, { status: 400 });
	}

	const [donation] = await db
		.select()
		.from(donations)
		.where(eq(donations.id, result.data.donationId))
		.limit(1);
	if (!donation?.providerOrderId) {
		return NextResponse.json({ error: "Payment verification failed." }, { status: 404 });
	}
	if (donation.providerPaymentId === result.data.razorpayPaymentId && donation.status === "paid") {
		return NextResponse.json({ status: "confirmed", donationId: donation.id });
	}
	if (donation.providerPaymentId && donation.providerPaymentId !== result.data.razorpayPaymentId) {
		return NextResponse.json({ error: "Payment verification failed." }, { status: 409 });
	}
	if (
		donation.providerOrderId !== result.data.razorpayOrderId ||
		!verifyRazorpayOrderPaymentSignature({
			orderId: donation.providerOrderId,
			paymentId: result.data.razorpayPaymentId,
			signature: result.data.razorpaySignature,
		})
	) {
		await db
			.update(donations)
			.set({ status: "failed", updatedAt: new Date() })
			.where(and(eq(donations.id, donation.id), eq(donations.status, "created")));
		return NextResponse.json({ error: "Payment verification failed." }, { status: 400 });
	}
	const providerPayment = await fetchRazorpayPayment(result.data.razorpayPaymentId);
	const amountValidation = validateRazorpayAmount({
		amount: providerPayment.amount,
		currency: providerPayment.currency,
		expectedAmountPaise: donation.amountInr * 100,
	});
	if (
		providerPayment.order_id !== donation.providerOrderId ||
		!amountValidation.valid
	) {
		await db
			.update(donations)
			.set({ status: "failed", updatedAt: new Date() })
			.where(and(eq(donations.id, donation.id), eq(donations.status, "created")));
		return NextResponse.json({ error: "Payment verification failed." }, { status: 400 });
	}
	if (providerPayment.status !== "captured") {
		return NextResponse.json({ status: "pending", donationId: donation.id }, { status: 202 });
	}

	await db
		.update(donations)
		.set({
			status: "paid",
			providerPaymentId: result.data.razorpayPaymentId,
			verifiedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(eq(donations.id, donation.id));
	return NextResponse.json({ status: "confirmed", donationId: donation.id });
}
