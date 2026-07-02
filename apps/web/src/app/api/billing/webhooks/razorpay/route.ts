import { NextResponse, type NextRequest } from "next/server";
import {
	verifyRazorpayWebhookSignature,
} from "@/billing/razorpay";
import { processRazorpayWebhook } from "@/billing/webhook";

export async function POST(request: NextRequest) {
	const rawBody = Buffer.from(await request.arrayBuffer());
	const signature = request.headers.get("x-razorpay-signature");
	let valid = false;
	try {
		valid = verifyRazorpayWebhookSignature({ rawBody, signature });
	} catch {
		return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
	}
	if (!valid) {
		console.error("razorpay_webhook_invalid_signature");
		return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
	}

	let payload: unknown;
	try {
		payload = JSON.parse(rawBody.toString("utf8"));
	} catch {
		console.error("razorpay_webhook_malformed_json");
		return NextResponse.json({ error: "Malformed payload" }, { status: 400 });
	}
	try {
		await processRazorpayWebhook(payload);
	} catch (error) {
		console.error("razorpay_webhook_processing_failed", {
			error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
		});
		return NextResponse.json({ error: "Webhook processing failed" }, { status: 422 });
	}
	return NextResponse.json({ received: true });
}
