import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { COMPARISONS } from "@/marketing/comparisons";

export const metadata: Metadata = {
	title: "Compare caption tools",
	description:
		"Honest, source-linked comparisons between Capinsta and other caption and video tools.",
	alternates: { canonical: "/compare" },
};

const comparisonAccents = [
	"var(--neo-pink)",
	"var(--neo-blue)",
	"var(--neo-teal)",
] as const;

export default function ComparePage() {
	return (
		<div className="marketing-theme">
			<Header />
			<main className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
				<h1 className="text-5xl font-black sm:text-7xl">
					Compare caption tools honestly.
				</h1>
				<p className="mt-5 max-w-2xl text-xl text-muted-foreground">
					No invented checkmarks. Volatile claims link to official provider
					pages and carry a verification date.
				</p>
				<div className="mt-12 grid gap-6 md:grid-cols-3">
					{COMPARISONS.map((item, index) => (
						<Link
							key={item.slug}
							href={`/compare/${item.slug}`}
							className="cap-brutal-card cap-focus p-6 transition-transform hover:-translate-y-1"
							style={{
								borderTopColor:
									comparisonAccents[index % comparisonAccents.length],
								borderTopWidth: 8,
							}}
						>
							<h2 className="text-2xl font-black">{item.title}</h2>
							<p className="mt-3 text-muted-foreground">{item.summary}</p>
							<span className="mt-6 inline-block font-black text-foreground">
								Read comparison
							</span>
						</Link>
					))}
				</div>
			</main>
			<Footer />
		</div>
	);
}
