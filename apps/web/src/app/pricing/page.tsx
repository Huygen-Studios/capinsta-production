import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { PrivateServerCheckoutButton } from "@/components/billing/razorpay-checkout-button";

export const metadata: Metadata = {
	title: "Pricing - Capinsta",
	description: "Choose Free captions or upgrade to a dedicated Private Server for heavy caption and export work.",
};

const cardClass =
	"cap-brutal-card flex h-full flex-col justify-between bg-card p-6 sm:p-8";

export default function PricingPage() {
	return (
		<div className="marketing-theme min-h-screen bg-background bg-grid-paper text-foreground">
			<Header />
			<main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
				<div className="max-w-3xl">
					<h1 className="text-4xl font-black tracking-tight sm:text-5xl">Pricing</h1>
					<p className="mt-4 text-base leading-7 text-muted-foreground">
						Start free on shared servers. Upgrade only when your caption and export
						workloads need dedicated capacity.
					</p>
				</div>
				<section className="mt-10 grid gap-6 md:grid-cols-2" aria-label="Pricing plans">
					<article className={cardClass}>
						<div>
							<div className="flex items-start justify-between gap-4">
								<div>
									<h2 className="text-2xl font-black">Free</h2>
									<p className="mt-2 text-sm text-muted-foreground">For everyday caption editing.</p>
								</div>
								<p className="text-3xl font-black">₹0</p>
							</div>
							<ul className="mt-6 space-y-3 text-sm leading-6">
								<li>Ads supported</li>
								<li>Shared processing servers</li>
								<li>Standard queue priority</li>
								<li>Basic usage limits from the active product rules</li>
							</ul>
						</div>
						<Link
							href="/projects"
							className="mt-8 flex h-11 items-center justify-center rounded-sm border-2 border-border bg-card px-4 text-sm font-black shadow-[4px_4px_0_var(--shadow-strong)]"
						>
							Continue Free
						</Link>
					</article>
					<article className={cardClass}>
						<div>
							<div className="flex items-start justify-between gap-4">
								<div>
									<h2 className="text-2xl font-black">Private Server</h2>
									<p className="mt-2 text-sm text-muted-foreground">For serious production workloads.</p>
								</div>
								<p className="text-3xl font-black">₹8,000/month</p>
							</div>
							<ul className="mt-6 space-y-3 text-sm leading-6">
								<li>No ads</li>
								<li>Dedicated processing server</li>
								<li>Private queue / priority processing</li>
								<li>Isolated worker allocation</li>
								<li>Better reliability for large caption/export workloads</li>
							</ul>
						</div>
						<div className="mt-8">
							<PrivateServerCheckoutButton />
						</div>
					</article>
				</section>
			</main>
			<Footer />
		</div>
	);
}
