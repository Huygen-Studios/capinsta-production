"use client";

import { useState } from "react";

declare global {
	interface Window {
		Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
	}
}

function loadRazorpayScript() {
	return new Promise<void>((resolve, reject) => {
		if (window.Razorpay) return resolve();
		const existing = document.querySelector<HTMLScriptElement>(
			'script[src="https://checkout.razorpay.com/v1/checkout.js"]',
		);
		if (existing) {
			existing.addEventListener("load", () => resolve(), { once: true });
			existing.addEventListener("error", reject, { once: true });
			return;
		}
		const script = document.createElement("script");
		script.src = "https://checkout.razorpay.com/v1/checkout.js";
		script.async = true;
		script.onload = () => resolve();
		script.onerror = reject;
		document.body.appendChild(script);
	});
}

function payloadValue({ payload, key }: { payload: unknown; key: string }) {
	return payload && typeof payload === "object" && key in payload
		? Reflect.get(payload, key)
		: undefined;
}

export function PrivateServerCheckoutButton() {
	const [state, setState] = useState<"idle" | "loading" | "pending" | "error">("idle");
	const [message, setMessage] = useState<string | null>(null);

	const start = async () => {
		if (state === "loading") return;
		setState("loading");
		setMessage(null);
		try {
			const response = await fetch("/api/billing/private-server/checkout", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}",
			});
			const payload: unknown = await response.json();
			const keyId = payloadValue({ payload, key: "keyId" });
			const subscriptionId = payloadValue({ payload, key: "subscriptionId" });
			const error = payloadValue({ payload, key: "error" });
			if (
				!response.ok ||
				typeof keyId !== "string" ||
				typeof subscriptionId !== "string"
			) {
				throw new Error(typeof error === "string" ? error : "Checkout unavailable");
			}
			await loadRazorpayScript();
			const Razorpay = window.Razorpay;
			if (!Razorpay) throw new Error("Razorpay checkout failed to load");
			new Razorpay({
				key: keyId,
				subscription_id: subscriptionId,
				name: "Capinsta",
				description: "Private Server subscription",
				handler: () => {
					setState("pending");
					setMessage("Payment submitted. Private Server activates only after verified webhook confirmation.");
				},
				modal: {
					ondismiss: () => {
						setState("idle");
					},
				},
			}).open();
		} catch (error) {
			setState("error");
			setMessage(error instanceof Error ? error.message : "Checkout unavailable");
		}
	};

	return (
		<div className="space-y-2">
			<button
				type="button"
				className="flex h-11 w-full items-center justify-center rounded-sm border-2 border-[var(--neo-black)] bg-primary px-4 text-sm font-black text-primary-foreground shadow-[4px_4px_0_var(--shadow-strong)] transition hover:bg-[var(--neo-yellow)] disabled:opacity-60"
				onClick={() => void start()}
				disabled={state === "loading" || state === "pending"}
			>
				{state === "loading"
					? "Opening checkout..."
					: state === "pending"
						? "Verification pending"
						: "Upgrade to Private Server"}
			</button>
			{message ? (
				<p
					className="text-xs leading-5 text-muted-foreground"
					role={state === "error" ? "alert" : "status"}
					aria-live="polite"
				>
					{message}
				</p>
			) : null}
		</div>
	);
}

export function DonationCheckoutButton({
	amountInr,
	donorName,
	donorMessage,
	anonymous,
	receiptEmail,
}: {
	amountInr: number;
	donorName: string;
	donorMessage: string;
	anonymous: boolean;
	receiptEmail: string;
}) {
	const [state, setState] = useState<"idle" | "loading" | "pending" | "error">("idle");
	const [message, setMessage] = useState<string | null>(null);

	const start = async () => {
		if (state === "loading") return;
		setState("loading");
		setMessage(null);
		try {
			const response = await fetch("/api/donations/checkout", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					amountInr,
					donorName: donorName || undefined,
					donorMessage: donorMessage || undefined,
					anonymous,
					receiptEmail: receiptEmail || undefined,
				}),
			});
			const payload: unknown = await response.json();
			const keyId = payloadValue({ payload, key: "keyId" });
			const orderId = payloadValue({ payload, key: "orderId" });
			const amount = payloadValue({ payload, key: "amount" });
			const currency = payloadValue({ payload, key: "currency" });
			const error = payloadValue({ payload, key: "error" });
			if (
				!response.ok ||
				typeof keyId !== "string" ||
				typeof orderId !== "string"
			) {
				throw new Error(typeof error === "string" ? error : "Donation checkout unavailable");
			}
			await loadRazorpayScript();
			const Razorpay = window.Razorpay;
			if (!Razorpay) throw new Error("Razorpay checkout failed to load");
			new Razorpay({
				key: keyId,
				order_id: orderId,
				amount: typeof amount === "number" ? amount : undefined,
				currency: typeof currency === "string" ? currency : "INR",
				name: "Capinsta",
				description: `Donation: INR ${amountInr}`,
				handler: () => {
					setState("pending");
					setMessage("Donation submitted. Receipt is created only after Razorpay webhook verification.");
				},
				modal: {
					ondismiss: () => setState("idle"),
				},
			}).open();
		} catch (error) {
			setState("error");
			setMessage(error instanceof Error ? error.message : "Donation checkout unavailable");
		}
	};

	return (
		<div className="space-y-2">
			<button
				type="button"
				className="flex h-11 w-full items-center justify-center rounded-sm border-2 border-[var(--neo-black)] bg-primary px-4 text-sm font-black text-primary-foreground shadow-[4px_4px_0_var(--shadow-strong)] transition hover:bg-[var(--neo-yellow)] disabled:opacity-60"
				onClick={() => void start()}
				disabled={state === "loading" || state === "pending"}
			>
				{state === "loading"
					? "Opening checkout..."
					: state === "pending"
						? "Verification pending"
						: `Donate ₹${amountInr.toLocaleString("en-IN")}`}
			</button>
			{message ? (
				<p
					className="text-xs leading-5 text-muted-foreground"
					role={state === "error" ? "alert" : "status"}
					aria-live="polite"
				>
					{message}
				</p>
			) : null}
		</div>
	);
}
