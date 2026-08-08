import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CompetitorAlternativePage from "@/components/marketing/CompetitorAlternativePage";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import { competitors } from "@/config/competitors";
import { createMetadata } from "@/config/site";

export const dynamicParams = false;

export function generateStaticParams() {
  return competitors.map((competitor) => ({ slug: competitor.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const competitor = competitors.find((item) => item.slug === params.slug);

  if (!competitor) {
    return createMetadata({
      title: "Alternative Not Found - Huygen Caps",
      description: "The requested Huygen Caps alternative page could not be found.",
      path: `/alternatives/${params.slug}`,
      noIndex: true,
    });
  }

  return createMetadata({
    title: competitor.pageTitle,
    description: competitor.metaDescription,
    path: `/alternatives/${competitor.slug}`,
    keywords: [`${competitor.name} alternative`, "auto subtitle generator", "animated captions"],
  });
}

export default function AlternativePage({ params }: { params: { slug: string } }) {
  const competitor = competitors.find((item) => item.slug === params.slug);

  if (!competitor) {
    notFound();
  }

  return (
    <MarketingLayout>
      <CompetitorAlternativePage competitor={competitor} />
    </MarketingLayout>
  );
}

