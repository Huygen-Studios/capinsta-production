import Link from "next/link";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import { ArticleStructuredData, BreadcrumbStructuredData } from "@/components/structured-data";
import { ROUTES, SITE_URL } from "@/site/brand";
import type { CompetitorComparison } from "@/marketing/comparisons";

export function ComparisonPage({ comparison }: { comparison: CompetitorComparison }) {
	const path = `/compare/${comparison.slug}`;
	return (
		<div className="marketing-theme">
			<ArticleStructuredData headline={comparison.title} description={comparison.description} path={path} datePublished="2026-06-21" dateModified="2026-06-21" />
			<BreadcrumbStructuredData items={[
				{ name: "Capinsta", url: SITE_URL },
				{ name: "Compare", url: `${SITE_URL}${ROUTES.compare}` },
				{ name: comparison.title, url: `${SITE_URL}${path}` },
			]} />
			<Header />
			<main className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
				<p className="font-black uppercase tracking-[.18em] text-primary">Independent comparison</p>
				<h1 className="mt-4 text-5xl font-black tracking-tight sm:text-7xl">{comparison.title}</h1>
				<p className="mt-6 max-w-3xl text-xl font-semibold leading-relaxed text-muted-foreground">{comparison.summary}</p>
				<p className="mt-4 text-sm font-bold">Last verified: {comparison.lastVerified}</p>

				<div className="mt-12 overflow-x-auto border-2 border-foreground bg-card text-card-foreground shadow-[5px_5px_0_var(--cap-shadow-color)]">
					<table className="w-full min-w-[680px] text-left">
						<thead className="bg-primary text-primary-foreground">
							<tr><th className="p-4">Feature</th><th className="p-4">Capinsta</th><th className="p-4">{comparison.competitor}</th></tr>
						</thead>
						<tbody>
							{comparison.claims.map((claim) => (
								<tr key={claim.label} className="border-t-2 border-black">
									<th className="p-4">{claim.label}</th>
									<td className="p-4">{claim.capinsta}</td>
									<td className="p-4">
										{claim.sourceUrl ? <a className="font-bold text-primary underline" href={claim.sourceUrl} target="_blank" rel="noreferrer">{claim.competitor}</a> : claim.competitor}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				<div className="mt-12 grid gap-6 md:grid-cols-2">
					<UseList title="Capinsta may fit you if…" items={comparison.capinstaFor} tone="primary" />
					<UseList title={`${comparison.competitor} may fit you if…`} items={comparison.competitorFor} tone="dark" />
					<UseList title="Capinsta strengths" items={comparison.pros} tone="primary" />
					<UseList title="Capinsta tradeoffs" items={comparison.cons} tone="secondary" />
				</div>

				<section className="mt-12 cap-brutal-card p-7">
					<h2 className="text-2xl font-black">Sources and methodology</h2>
					<p className="mt-3 text-muted-foreground">Volatile plan limits, pricing, watermarks, and export details should be checked directly with each provider.</p>
					<ul className="mt-4 list-disc space-y-2 pl-5">
						{comparison.sourceUrls.map((source) => <li key={source}><a href={source} className="font-bold underline" target="_blank" rel="noreferrer">{source}</a></li>)}
					</ul>
					<p className="mt-5 text-sm font-semibold">Capinsta is independent and is not affiliated with {comparison.competitor}.</p>
				</section>

				<div className="mt-12 text-center">
					<h2 className="text-3xl font-black">Try the focused caption workflow</h2>
					<Button asChild variant="lime" size="lg" className="mt-6 font-black"><Link href={ROUTES.projects}>Caption a video free</Link></Button>
				</div>
			</main>
			<Footer />
		</div>
	);
}

function UseList({
	title,
	items,
	tone,
}: {
	title: string;
	items: string[];
	tone: "primary" | "secondary" | "dark";
}) {
	const toneClass =
		tone === "primary"
			? "bg-primary text-primary-foreground"
			: tone === "secondary"
				? "bg-secondary text-secondary-foreground"
				: "bg-background text-foreground";
	return <section className={`border-2 border-foreground p-6 shadow-[4px_4px_0_var(--cap-shadow-color)] ${toneClass}`}><h2 className="text-xl font-black">{title}</h2><ul className="mt-4 list-disc space-y-2 pl-5 font-semibold">{items.map((item) => <li key={item}>{item}</li>)}</ul></section>;
}
