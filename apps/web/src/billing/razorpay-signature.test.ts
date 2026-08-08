import { createHmac } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

mock.module("@/env/web", () => ({
	webEnv: {
		PAYMENTS_ENABLED: "true",
		PAYMENT_ENVIRONMENT: "test",
		RAZORPAY_KEY_ID: "rzp_test_key",
		RAZORPAY_KEY_SECRET: "test_key_secret",
		RAZORPAY_WEBHOOK_SECRET: "test_webhook_secret",
		RAZORPAY_WEBHOOK_PREVIOUS_SECRET: "previous_webhook_secret",
	},
}));

describe("Razorpay signature helpers", () => {
	test("verifies a valid donation order payment signature", async () => {
		const { verifyRazorpayOrderPaymentSignature } = await import("./razorpay");
		const orderId = "order_test";
		const paymentId = "pay_test";
		const signature = createHmac("sha256", "test_key_secret")
			.update(`${orderId}|${paymentId}`)
			.digest("hex");
		expect(
			verifyRazorpayOrderPaymentSignature({ orderId, paymentId, signature }),
		).toBe(true);
	});

	test("rejects an altered donation order id", async () => {
		const { verifyRazorpayOrderPaymentSignature } = await import("./razorpay");
		const signature = createHmac("sha256", "test_key_secret")
			.update("order_test|pay_test")
			.digest("hex");
		expect(
			verifyRazorpayOrderPaymentSignature({
				orderId: "order_attacker",
				paymentId: "pay_test",
				signature,
			}),
		).toBe(false);
	});

	test("rejects invalid webhook signatures and accepts raw-byte exact signatures", async () => {
		const { verifyRazorpayWebhookSignature } = await import("./razorpay");
		const body = Buffer.from('{"event":"payment.captured","payload":{}}');
		const signature = createHmac("sha256", "test_webhook_secret")
			.update(body)
			.digest("hex");
		expect(verifyRazorpayWebhookSignature({ rawBody: body, signature })).toBe(true);
		expect(
			verifyRazorpayWebhookSignature({
				rawBody: Buffer.from('{"payload":{},"event":"payment.captured"}'),
				signature,
			}),
		).toBe(false);
		expect(verifyRazorpayWebhookSignature({ rawBody: body, signature: "bad" })).toBe(false);
	});
});
