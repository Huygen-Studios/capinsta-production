"use client";

import { useState } from "react";

declare global {
	interface Window {
		Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
	}
}

type RazorpayDonationResponse = {
	razorpay_payment_id?: string;
	razorpay_order_id?: string;
	razorpay_signature?: string;
};

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

export function DonationCheckoutButton({
	donationTierId,
	amountInr,
	amountLabel,
	donorName,
	donorMessage,
	anonymous,
	receiptEmail,
}: {
	donationTierId: string;
	amountInr: number;
	amountLabel: string;
	donorName: string;
	donorMessage: string;
	anonymous: boolean;
	receiptEmail: string;
}) {
	const [state, setState] = useState<"idle" | "loading" | "verifying" | "pending" | "confirmed" | "error">("idle");
	const [message, setMessage] = useState<string | null>(null);

	const start = async () => {
		if (state === "loading" || state === "verifying") return;
		setState("loading");
		setMessage(null);
		try {
			if (!anonymous && !donorName.trim()) {
				throw new Error("Enter a donor name or choose Donate anonymously.");
			}
			const response = await fetch("/api/payments/donations/create-order", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					donationTierId,
					donorName: donorName || undefined,
					donorMessage: donorMessage || undefined,
					anonymous,
					receiptEmail: receiptEmail || undefined,
				}),
			});
			const payload: unknown = await response.json();
			const keyId = payloadValue({ payload, key: "keyId" });
			const orderId = payloadValue({ payload, key: "orderId" });
			const donationId = payloadValue({ payload, key: "donationId" });
			const amount = payloadValue({ payload, key: "amount" });
			const currency = payloadValue({ payload, key: "currency" });
			const error = payloadValue({ payload, key: "error" });
			if (
				!response.ok ||
				typeof keyId !== "string" ||
				typeof orderId !== "string" ||
				typeof donationId !== "string"
			) {
				throw new Error(typeof error === "string" ? error : "Payments are temporarily unavailable. Please try again later.");
			}
			await loadRazorpayScript();
			const Razorpay = window.Razorpay;
			if (!Razorpay) throw new Error("Secure checkout could not be loaded. Please refresh and try again.");
			new Razorpay({
				key: keyId,
				order_id: orderId,
				amount: typeof amount === "number" ? amount : amountInr * 100,
				currency: typeof currency === "string" ? currency : "INR",
				name: "Capinsta",
				description: `Donation: ${amountLabel}`,
				prefill: {
					name: anonymous ? "" : donorName,
					email: receiptEmail,
				},
				handler: async (checkoutResponse: RazorpayDonationResponse) => {
					setState("verifying");
					setMessage("Verifying payment...");
					const verifyResponse = await fetch("/api/payments/donations/verify", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							donationId,
							razorpayPaymentId: checkoutResponse.razorpay_payment_id,
							razorpayOrderId: checkoutResponse.razorpay_order_id,
							razorpaySignature: checkoutResponse.razorpay_signature,
						}),
					});
					if (!verifyResponse.ok) {
						setState("error");
						setMessage("We could not verify this payment. Please contact support with your reference number.");
						return;
					}
					setState("confirmed");
					setMessage("Thank you. Your donation has been confirmed.");
				},
				modal: {
					ondismiss: () => {
						setState("idle");
						setMessage("Payment was cancelled.");
					},
				},
			}).open();
		} catch (error) {
			setState("error");
			setMessage(error instanceof Error ? error.message : "Payments are temporarily unavailable. Please try again later.");
		}
	};

	return (
		<div className="space-y-2">
			<button
				type="button"
				className="flex h-11 w-full items-center justify-center rounded-sm border-2 border-[var(--neo-black)] bg-primary px-4 text-sm font-black text-primary-foreground shadow-[4px_4px_0_var(--shadow-strong)] transition hover:bg-[var(--neo-yellow)] disabled:opacity-60"
				onClick={() => void start()}
				disabled={state === "loading" || state === "verifying" || state === "pending" || state === "confirmed"}
			>
				{state === "loading"
					? "Preparing secure checkout..."
					: state === "verifying"
						? "Verifying payment..."
						: state === "pending"
							? "Payment pending"
							: state === "confirmed"
								? "Donation confirmed"
								: `Donate ${amountLabel}`}
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
