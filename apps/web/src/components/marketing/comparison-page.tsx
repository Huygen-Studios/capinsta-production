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
				<p className="font-black uppercase tracking-[.18em] text-[var(--cap-purple-600)]">Independent comparison</p>
				<h1 className="mt-4 text-5xl font-black tracking-tight sm:text-7xl">{comparison.title}</h1>
				<p className="mt-6 max-w-3xl text-xl font-semibold leading-relaxed text-black/65">{comparison.summary}</p>
				<p className="mt-4 text-sm font-bold">Last verified: {comparison.lastVerified}</p>

				<div className="mt-12 overflow-x-auto rounded-xl border-2 border-black bg-white shadow-[5px_5px_0_#111]">
					<table className="w-full min-w-[680px] text-left">
						<thead className="bg-[var(--cap-lime)]">
							<tr><th className="p-4">Feature</th><th className="p-4">Capinsta</th><th className="p-4">{comparison.competitor}</th></tr>
						</thead>
						<tbody>
							{comparison.claims.map((claim) => (
								<tr key={claim.label} className="border-t-2 border-black">
									<th className="p-4">{claim.label}</th>
									<td className="p-4">{claim.capinsta}</td>
									<td className="p-4">
										{claim.sourceUrl ? <a className="font-bold text-[var(--cap-purple-600)] underline" href={claim.sourceUrl} target="_blank" rel="noreferrer">{claim.competitor}</a> : claim.competitor}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				<div className="mt-12 grid gap-6 md:grid-cols-2">
					<UseList title="Capinsta may fit you if…" items={comparison.capinstaFor} color="bg-[var(--cap-purple-200)]" />
					<UseList title={`${comparison.competitor} may fit you if…`} items={comparison.competitorFor} color="bg-[var(--cap-yellow)]" />
					<UseList title="Capinsta strengths" items={comparison.pros} color="bg-[var(--cap-lime)]" />
					<UseList title="Capinsta tradeoffs" items={comparison.cons} color="bg-[var(--cap-pink)]" />
				</div>

				<section className="mt-12 cap-brutal-card p-7">
					<h2 className="text-2xl font-black">Sources and methodology</h2>
					<p className="mt-3 text-black/65">Volatile plan limits, pricing, watermarks, and export details should be checked directly with each provider.</p>
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

function UseList({ title, items, color }: { title: string; items: string[]; color: string }) {
	return <section className={`rounded-xl border-2 border-black p-6 shadow-[4px_4px_0_#111] ${color}`}><h2 className="text-xl font-black">{title}</h2><ul className="mt-4 list-disc space-y-2 pl-5 font-semibold">{items.map((item) => <li key={item}>{item}</li>)}</ul></section>;
}
