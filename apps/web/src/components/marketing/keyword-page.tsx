import Link from "next/link";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/site/brand";
import type { KeywordPageDefinition } from "@/marketing/keyword-pages";

export function KeywordPage({ page }: { page: KeywordPageDefinition }) {
	return <div className="marketing-theme"><Header /><main>
		<section className="border-b-2 border-foreground bg-secondary"><div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28"><h1 className="max-w-5xl text-5xl font-black leading-[.9] tracking-tight sm:text-7xl">{page.headline}</h1><p className="mt-7 max-w-3xl text-xl font-semibold leading-relaxed">{page.intro}</p><div className="mt-8 flex flex-wrap gap-4"><Button asChild variant="lime" size="lg" className="font-black"><Link href={ROUTES.projects}>Caption a video free</Link></Button><Button asChild variant="brutal" size="lg" className="font-black"><Link href={ROUTES.captionPresets}>See caption styles</Link></Button></div><p className="mt-5 text-sm font-bold">Currently free during public beta.</p></div></section>
		<section className="mx-auto grid max-w-6xl gap-6 px-4 py-20 sm:px-6 md:grid-cols-3">{page.points.map((point, index) => <article key={point.title} className={`cap-brutal-card p-6 ${index === 1 ? "md:translate-y-6" : ""}`}><span className="inline-grid size-10 place-items-center border-2 border-foreground bg-primary font-black text-primary-foreground">{index + 1}</span><h2 className="mt-5 text-2xl font-black">{point.title}</h2><p className="mt-3 leading-relaxed text-muted-foreground">{point.description}</p></article>)}</section>
	</main><Footer /></div>;
}
