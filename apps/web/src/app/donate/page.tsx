import type { Metadata } from "next";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { DonationForm } from "./donation-form";

export const metadata: Metadata = {
	title: "Donate - Capinsta",
	description: "Support Capinsta infrastructure with a one-time verified Razorpay donation.",
};

export default function DonatePage() {
	return (
		<div className="marketing-theme min-h-screen bg-background bg-grid-paper text-foreground">
			<Header />
			<main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
				<div className="max-w-3xl">
					<h1 className="text-4xl font-black tracking-tight sm:text-5xl">Donate</h1>
					<p className="mt-4 text-base leading-7 text-muted-foreground">
						One-time donations support infrastructure and debugging time. Donations
						do not unlock Private Server access or alter paid entitlements.
					</p>
				</div>
				<div className="mt-10">
					<DonationForm />
				</div>
			</main>
			<Footer />
		</div>
	);
}
