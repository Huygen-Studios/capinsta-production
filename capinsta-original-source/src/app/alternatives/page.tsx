import type { Metadata } from "next";
import Link from "next/link";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import { competitors } from "@/config/competitors";
import { createMetadata } from "@/config/site";

export const metadata: Metadata = createMetadata({
  title: "Auto Subtitle Generator Alternatives - Huygen Caps",
  description: "Compare Huygen Caps with popular auto subtitle generator and animated caption tools for short-form creators.",
  path: "/alternatives",
});

export default function AlternativesIndexPage() {
  return (
    <MarketingLayout>
      <section className="marketing-hero compact">
        <p className="marketing-eyebrow">Alternatives</p>
        <h1>Auto subtitle generator alternatives for creators</h1>
        <p>
          Compare Huygen Caps with other tools for auto subtitles, AI captions, animated word-by-word captions and
          short-form exports.
        </p>
      </section>
      <section className="marketing-section">
        <div className="marketing-grid">
          {competitors.map((competitor) => (
            <article className="marketing-card" key={competitor.slug}>
              <h2>{competitor.name} Alternative</h2>
              <p>{competitor.metaDescription}</p>
              <Link href={`/alternatives/${competitor.slug}`}>Read comparison</Link>
            </article>
          ))}
        </div>
      </section>
    </MarketingLayout>
  );
}
