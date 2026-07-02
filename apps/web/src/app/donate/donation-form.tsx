"use client";

import { useState } from "react";
import { DONATION_LEVELS } from "@/billing/plans";
import { DonationCheckoutButton } from "@/components/billing/razorpay-checkout-button";
import { authInputClass } from "@/components/auth/auth-shell";

export function DonationForm() {
	const [amount, setAmount] = useState(500);
	const [donorName, setDonorName] = useState("");
	const [donorMessage, setDonorMessage] = useState("");
	const [receiptEmail, setReceiptEmail] = useState("");
	const [anonymous, setAnonymous] = useState(false);

	return (
		<div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
			<section className="grid gap-4 sm:grid-cols-2">
				{DONATION_LEVELS.map((level) => (
					<button
						type="button"
						key={level.amount}
						onClick={() => setAmount(level.amount)}
						className={`cap-brutal-card bg-card p-5 text-left transition ${
							amount === level.amount ? "border-primary" : ""
						}`}
					>
						<p className="text-2xl font-black">₹{level.amount.toLocaleString("en-IN")}</p>
						<p className="mt-2 text-sm font-semibold">{level.label}</p>
					</button>
				))}
			</section>
			<section className="cap-brutal-card bg-card p-6">
				<h2 className="text-2xl font-black">Donation details</h2>
				<div className="mt-5 space-y-4">
					<label className="block text-sm font-semibold">
						Donor name
						<input
							className={authInputClass}
							value={donorName}
							onChange={(event) => setDonorName(event.target.value)}
							disabled={anonymous}
						/>
					</label>
					<label className="block text-sm font-semibold">
						Optional message
						<textarea
							className={`${authInputClass} min-h-24 py-3`}
							value={donorMessage}
							onChange={(event) => setDonorMessage(event.target.value)}
							maxLength={240}
						/>
					</label>
					<label className="block text-sm font-semibold">
						Receipt email
						<input
							type="email"
							className={authInputClass}
							value={receiptEmail}
							onChange={(event) => setReceiptEmail(event.target.value)}
						/>
					</label>
					<label className="flex items-center gap-3 text-sm font-semibold">
						<input
							type="checkbox"
							checked={anonymous}
							onChange={(event) => setAnonymous(event.target.checked)}
						/>
						Donate anonymously
					</label>
					<DonationCheckoutButton
						amountInr={amount}
						donorName={donorName}
						donorMessage={donorMessage}
						anonymous={anonymous}
						receiptEmail={receiptEmail}
					/>
				</div>
			</section>
		</div>
	);
}
