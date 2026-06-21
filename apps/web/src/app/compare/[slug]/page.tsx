import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ComparisonPage } from "@/components/marketing/comparison-page";
import { COMPARISONS, getComparison } from "@/marketing/comparisons";
import { SITE_URL } from "@/site/brand";

export function generateStaticParams() {
	return COMPARISONS.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
	const { slug } = await params;
	const comparison = getComparison(slug);
	if (!comparison) return {};
	const path = `/compare/${slug}`;
	return {
		title: comparison.title,
		description: comparison.description,
		alternates: { canonical: path },
		openGraph: { title: comparison.title, description: comparison.description, url: `${SITE_URL}${path}` },
		twitter: { card: "summary_large_image", title: comparison.title, description: comparison.description },
	};
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
	const comparison = getComparison((await params).slug);
	if (!comparison) notFound();
	return <ComparisonPage comparison={comparison} />;
}
