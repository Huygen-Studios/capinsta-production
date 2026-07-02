import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { webEnv } from "@/env/web";

export type RazorpayOrderResponse = {
	id: string;
	status: string;
	amount: number;
	currency: string;
	[key: string]: unknown;
};

export type RazorpayPaymentResponse = {
	id: string;
	status: string;
	amount: number;
	currency: string;
	order_id?: string;
	[key: string]: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object") return {};
	return Object.fromEntries(Object.entries(value));
}

function parseOrderResponse(payload: unknown): RazorpayOrderResponse {
	const record = asRecord(payload);
	if (
		typeof record.id !== "string" ||
		typeof record.status !== "string" ||
		typeof record.amount !== "number" ||
		typeof record.currency !== "string"
	) {
		throw new Error("Invalid Razorpay order response");
	}
	return {
		...record,
		id: record.id,
		status: record.status,
		amount: record.amount,
		currency: record.currency,
	};
}

function parsePaymentResponse(payload: unknown): RazorpayPaymentResponse {
	const record = asRecord(payload);
	if (
		typeof record.id !== "string" ||
		typeof record.status !== "string" ||
		typeof record.amount !== "number" ||
		typeof record.currency !== "string"
	) {
		throw new Error("Invalid Razorpay payment response");
	}
	return {
		...record,
		id: record.id,
		status: record.status,
		amount: record.amount,
		currency: record.currency,
		order_id: typeof record.order_id === "string" ? record.order_id : undefined,
	};
}

export function razorpayPublicConfig() {
	if (webEnv.PAYMENTS_ENABLED !== "true" || !webEnv.RAZORPAY_KEY_ID) return null;
	if (!razorpayKeyMatchesPaymentEnvironment({ keyId: webEnv.RAZORPAY_KEY_ID })) return null;
	return {
		keyId: webEnv.RAZORPAY_KEY_ID,
		environment: webEnv.PAYMENT_ENVIRONMENT,
	};
}

function razorpayKeyMatchesPaymentEnvironment({ keyId }: { keyId: string }) {
	if (webEnv.PAYMENT_ENVIRONMENT === "test") return keyId.startsWith("rzp_test_");
	if (webEnv.PAYMENT_ENVIRONMENT === "live") return keyId.startsWith("rzp_live_");
	return false;
}

function razorpayApiConfig() {
	if (
		webEnv.PAYMENTS_ENABLED !== "true" ||
		!webEnv.RAZORPAY_KEY_ID ||
		!webEnv.RAZORPAY_KEY_SECRET ||
		!razorpayKeyMatchesPaymentEnvironment({ keyId: webEnv.RAZORPAY_KEY_ID })
	) {
		return null;
	}
	return {
		keyId: webEnv.RAZORPAY_KEY_ID,
		keySecret: webEnv.RAZORPAY_KEY_SECRET,
	};
}

function razorpayWebhookConfig() {
	if (webEnv.PAYMENTS_ENABLED !== "true" || !webEnv.RAZORPAY_WEBHOOK_SECRET) {
		return null;
	}
	return {
		webhookSecret: webEnv.RAZORPAY_WEBHOOK_SECRET,
		previousWebhookSecret: webEnv.RAZORPAY_WEBHOOK_PREVIOUS_SECRET,
	};
}

export function assertRazorpayConfigured() {
	const config = razorpayApiConfig();
	if (!config) throw new Error("razorpay_not_configured");
	return config;
}

function assertRazorpayWebhookConfigured() {
	const config = razorpayWebhookConfig();
	if (!config) throw new Error("razorpay_webhook_not_configured");
	return config;
}

async function razorpayPost({
	path,
	body,
}: {
	path: string;
	body: Record<string, unknown>;
}) {
	const { keyId, keySecret } = assertRazorpayConfigured();
	const response = await fetch(`https://api.razorpay.com/v1${path}`, {
		method: "POST",
		headers: {
			authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
			"content-type": "application/json",
		},
		body: JSON.stringify(body),
		cache: "no-store",
	});
	const payload: unknown = await response.json().catch(() => ({}));
	if (!response.ok) {
		const message =
			typeof payload === "object" && payload && "error" in payload
				? JSON.stringify(Reflect.get(payload, "error")).slice(0, 300)
				: `Razorpay request failed with ${response.status}`;
		throw new Error(message);
	}
	return payload;
}

async function razorpayGet({ path }: { path: string }) {
	const { keyId, keySecret } = assertRazorpayConfigured();
	const response = await fetch(`https://api.razorpay.com/v1${path}`, {
		method: "GET",
		headers: {
			authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
		},
		cache: "no-store",
	});
	const payload: unknown = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(`Razorpay fetch failed with ${response.status}`);
	}
	return payload;
}

export async function createDonationOrder({
	amountPaise,
	receipt,
	notes,
}: {
	amountPaise: number;
	receipt: string;
	notes: Record<string, string>;
}) {
	return parseOrderResponse(
		await razorpayPost({
			path: "/orders",
			body: {
				amount: amountPaise,
				currency: "INR",
				receipt,
				notes,
			},
		}),
	);
}

function safeHexCompare({ expected, actual }: { expected: string; actual: string }) {
	try {
		const actualBuffer = Buffer.from(actual, "hex");
		const expectedBuffer = Buffer.from(expected, "hex");
		return (
			actualBuffer.length === expectedBuffer.length &&
			timingSafeEqual(actualBuffer, expectedBuffer)
		);
	} catch {
		return false;
	}
}

export function verifyRazorpayOrderPaymentSignature({
	orderId,
	paymentId,
	signature,
}: {
	orderId: string;
	paymentId: string;
	signature: string;
}) {
	const { keySecret } = assertRazorpayConfigured();
	const expected = createHmac("sha256", keySecret)
		.update(`${orderId}|${paymentId}`)
		.digest("hex");
	return safeHexCompare({ expected, actual: signature });
}

export async function fetchRazorpayPayment(paymentId: string) {
	if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) {
		throw new Error("invalid_razorpay_payment_id");
	}
	return parsePaymentResponse(await razorpayGet({ path: `/payments/${paymentId}` }));
}

export function verifyRazorpayWebhookSignature({
	rawBody,
	signature,
}: {
	rawBody: string | Buffer;
	signature: string | null;
}) {
	if (!signature) return false;
	const { webhookSecret, previousWebhookSecret } = assertRazorpayWebhookConfigured();
	const secrets = [webhookSecret, previousWebhookSecret].filter(Boolean);
	return secrets.some((secret) => {
		const expected = createHmac("sha256", secret!)
			.update(rawBody)
			.digest("hex");
		return safeHexCompare({ expected, actual: signature });
	});
}
