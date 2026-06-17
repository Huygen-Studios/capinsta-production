import Link from "next/link";
import { comparisonFeatures, type CompetitorConfig } from "@/config/competitors";
import { siteConfig } from "@/config/site";
import { BreadcrumbJsonLd, FaqSection } from "./PageSections";

const internalLinks = [
  ["Auto Subtitle Generator", "/auto-subtitle-generator"],
  ["AI Caption Generator", "/ai-caption-generator"],
  ["Animated Captions", "/animated-captions"],
  ["Word-by-Word Captions", "/word-by-word-captions"],
  ["Captions for Reels", "/captions-for-reels"],
  ["Pricing", "/pricing"],
  ["Contact", "/contact"],
];

export default function CompetitorAlternativePage({ competitor }: { competitor: CompetitorConfig }) {
  const path = `/alternatives/${competitor.slug}`;

  return (
    <>
      <BreadcrumbJsonLd items={[{ name: "Home", path: "/" }, { name: "Alternatives", path: "/alternatives" }, { name: competitor.h1, path }]} />
      <section className="marketing-hero compact">
        <p className="marketing-eyebrow">{competitor.name} alternative</p>
        <h1>{competitor.h1}</h1>
        <p>
          Compare Huygen Caps with {competitor.name} for generating subtitles, editing word-level timing, creating animated
          captions, and exporting short-form videos.
        </p>
        <div className="marketing-cta-row">
          <Link className="marketing-button primary" href={siteConfig.appPath}>
            Try Huygen Caps
          </Link>
          <a className="marketing-button secondary" href="#compare-features">
            Compare Features
          </a>
        </div>
        <p className="comparison-disclaimer">{competitor.disclaimer}</p>
      </section>

      <section className="marketing-section two-column">
        <div>
          <p className="marketing-eyebrow">Why compare</p>
          <h2>Why compare Huygen Caps with {competitor.name}?</h2>
          <p>{competitor.intro}</p>
          <p>
            This page is for people researching a {competitor.name} alternative, an auto subtitle generator, an AI caption
            generator, animated captions, word-by-word captions, subtitle timing editor workflows, captions for Reels,
            captions for YouTube Shorts and TikTok captions. It is not an official {competitor.name} page.
          </p>
        </div>
        <div className="marketing-panel">
          <h2>Best fit signals</h2>
          <ul>
            {competitor.bestFor.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="marketing-section two-column">
        <div>
          <h2>Where {competitor.name} is strong</h2>
          <p>
            {competitor.name} may be a strong option for users who want its current official feature set, ecosystem,
            integrations or plan structure. Because product details change, any exact statement about {competitor.name}
            pricing, watermark rules, export formats or account limits should be checked on{" "}
            <a href={competitor.officialWebsite} rel="nofollow noopener noreferrer" target="_blank">
              the official {competitor.name} website
            </a>{" "}
            before publishing.
          </p>
          <ul className="comparison-list">
            {competitor.comparisonAngles.map((angle) => (
              <li key={angle}>{angle}</li>
            ))}
          </ul>
        </div>
        <div>
          <h2>Where Huygen Caps is focused</h2>
          <p>
            Huygen Caps is intentionally centered on subtitle-led creator workflows. The product positioning is narrower:
            generate auto subtitles, review AI-assisted caption text, refine word-level timing, create animated captions and
            export videos that are ready for social review.
          </p>
          <ul className="comparison-list">
            {competitor.huygenCapsAdvantages.map((advantage) => (
              <li key={advantage}>{advantage}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="marketing-section" id="compare-features">
        <div className="marketing-section-header">
          <p className="marketing-eyebrow">Feature comparison</p>
          <h2>Compare the workflow before you switch</h2>
          <p>
            These labels are intentionally conservative. Competitor statuses and any unconfirmed Huygen Caps export details
            must be verified before publishing final sales claims.
          </p>
        </div>
        <div className="comparison-table-wrap">
          <table className="comparison-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Huygen Caps</th>
                <th>{competitor.name}</th>
              </tr>
            </thead>
            <tbody>
              {comparisonFeatures.map((feature) => (
                <tr key={feature.label}>
                  <td>{feature.label}</td>
                  <td>{feature.huygenCaps}</td>
                  <td>{feature.competitor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="marketing-section two-column">
        <div>
          <h2>Best choice by use case</h2>
          <p>
            Choose the tool that matches the work. If you need broad design or editing features, verify whether{" "}
            {competitor.name} has the exact capabilities, limits and export settings you need. If your main workflow is
            caption finishing for Reels, Shorts, TikToks, podcast clips or talking-head videos, Huygen Caps is designed to
            keep subtitle generation, animated captions and timing review close together.
          </p>
        </div>
        <div className="marketing-panel">
          <h2>How to switch</h2>
          <ol className="marketing-steps">
            {competitor.switchingSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      </section>

      <section className="marketing-section seo-copy">
        <h2>Useful pages while comparing {competitor.name} alternatives</h2>
        <p>
          Keep your comparison practical. Read about Huygen Caps as an auto subtitle generator, review the AI caption
          generator workflow, compare animated captions, and check pricing before you move production clips into a new tool.
        </p>
        <div className="comparison-link-grid">
          {internalLinks.map(([label, href]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
        </div>
      </section>

      <section className="marketing-section">
        <div className="marketing-section-header">
          <p className="marketing-eyebrow">Verification notes</p>
          <h2>Claims to verify before publishing</h2>
        </div>
        <ul className="comparison-list">
          {competitor.limitationsToVerify.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <FaqSection faqs={competitor.faqItems} pagePath={path} />

      <section className="marketing-final-cta">
        <p className="comparison-disclaimer">{competitor.disclaimer}</p>
        <h2>Try Huygen Caps for auto subtitles and animated captions</h2>
        <p>Generate subtitles, review word-level timing, style captions and export short-form videos.</p>
        <Link className="marketing-button primary" href={siteConfig.appPath}>
          Try Huygen Caps
        </Link>
      </section>
    </>
  );
}

