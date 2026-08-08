import type { Metadata } from "next";
import { notFound } from "next/navigation";
import KeywordLandingPage from "@/components/marketing/KeywordLandingPage";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import { createMetadata, keywordPages } from "@/config/site";

export const dynamicParams = false;

export function generateStaticParams() {
  return keywordPages.map((page) => ({ slug: page.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const page = keywordPages.find((item) => item.slug === params.slug);
  if (!page) {
    return createMetadata({
      title: "Page Not Found - Huygen Caps",
      description: "The requested Huygen Caps page could not be found.",
      path: `/${params.slug}`,
      noIndex: true,
    });
  }

  return createMetadata({
    title: page.title,
    description: page.description,
    path: `/${page.slug}`,
    keywords: [page.keyword],
  });
}

export default function KeywordPage({ params }: { params: { slug: string } }) {
  const page = keywordPages.find((item) => item.slug === params.slug);

  if (!page) {
    notFound();
  }

  return (
    <MarketingLayout>
      <KeywordLandingPage page={page} />
    </MarketingLayout>
  );
}
