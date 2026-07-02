import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { webEnv } from "@/env/web";

export type RazorpaySubscriptionResponse = {
	id: string;
	status: string;
	short_url?: string;
	[key: string]: unknown;
};

export type RazorpayOrderResponse = {
	id: string;
	status: string;
	amount: number;
	currency: string;
	[key: string]: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object") return {};
	return Object.fromEntries(Object.entries(value));
}

function parseSubscriptionResponse(payload: unknown): RazorpaySubscriptionResponse {
	const record = asRecord(payload);
	if (typeof record.id !== "string" || typeof record.status !== "string") {
		throw new Error("Invalid Razorpay subscription response");
	}
	return {
		...record,
		id: record.id,
		status: record.status,
		short_url: typeof record.short_url === "string" ? record.short_url : undefined,
	};
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

export function razorpayPublicConfig() {
	if (!webEnv.RAZORPAY_KEY_ID) return null;
	return { keyId: webEnv.RAZORPAY_KEY_ID };
}

function razorpayServerConfig() {
	if (
		!webEnv.RAZORPAY_KEY_ID ||
		!webEnv.RAZORPAY_KEY_SECRET ||
		!webEnv.RAZORPAY_WEBHOOK_SECRET
	) {
		return null;
	}
	return {
		keyId: webEnv.RAZORPAY_KEY_ID,
		keySecret: webEnv.RAZORPAY_KEY_SECRET,
		webhookSecret: webEnv.RAZORPAY_WEBHOOK_SECRET,
	};
}

export function assertRazorpayConfigured() {
	const config = razorpayServerConfig();
	if (!config) throw new Error("razorpay_not_configured");
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

export async function createPrivateServerSubscription({
	userId,
	email,
}: {
	userId: string;
	email: string | null;
}) {
	if (!webEnv.RAZORPAY_PRIVATE_SERVER_PLAN_ID)
		throw new Error("razorpay_plan_not_configured");
	return parseSubscriptionResponse(
		await razorpayPost({
			path: "/subscriptions",
			body: {
				plan_id: webEnv.RAZORPAY_PRIVATE_SERVER_PLAN_ID,
				total_count: 120,
				quantity: 1,
				customer_notify: 1,
				notes: {
					capinsta_user_id: userId,
					capinsta_plan: "private_server",
					email: email ?? "",
				},
			},
		},
		),
	);
}

export async function createDonationOrder({
	amountInr,
	receipt,
	notes,
}: {
	amountInr: number;
	receipt: string;
	notes: Record<string, string>;
}) {
	return parseOrderResponse(
		await razorpayPost({
			path: "/orders",
			body: {
				amount: amountInr * 100,
				currency: "INR",
				receipt,
				notes,
			},
		}),
	);
}

export function verifyRazorpayWebhookSignature({
	rawBody,
	signature,
}: {
	rawBody: string | Buffer;
	signature: string | null;
}) {
	if (!signature) return false;
	const { webhookSecret } = assertRazorpayConfigured();
	const expected = createHmac("sha256", webhookSecret)
		.update(rawBody)
		.digest("hex");
	const actual = Buffer.from(signature, "hex");
	const expectedBuffer = Buffer.from(expected, "hex");
	return (
		actual.length === expectedBuffer.length &&
		timingSafeEqual(actual, expectedBuffer)
	);
}
