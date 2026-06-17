import type { Metadata } from "next";
import Link from "next/link";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import JsonLd from "@/components/marketing/JsonLd";
import { CtaRow, FaqSection, FeatureGrid, SectionHeader, SoftwareJsonLd } from "@/components/marketing/PageSections";
import { createMetadata, homeFaqs, siteConfig } from "@/config/site";

export const metadata: Metadata = createMetadata({
  title: siteConfig.defaultTitle,
  description: siteConfig.defaultDescription,
  path: "/",
  keywords: ["Auto Subtitle Generator", "AI Caption Generator"],
});

const features = [
  {
    title: "Word-by-word captions",
    body: "Create captions that can follow speech at a word level, then review the text before publishing.",
  },
  {
    title: "Animated caption presets",
    body: "Apply social-ready caption styles for talking-head clips, podcast cuts and fast creator edits.",
  },
  {
    title: "Subtitle timing editor",
    body: "Fix timing, review playback and keep AI-assisted captions aligned with your video.",
  },
  {
    title: "Reels, Shorts and TikTok formats",
    body: "Work with vertical video workflows built around the formats creators publish every day.",
  },
  {
    title: "Burned-in caption export",
    body: "Render captions directly into the final video so the result is ready for platform upload.",
  },
  {
    title: "Creator workflow support",
    body: "Move from upload to caption generation, styling and export without rebuilding your edit from scratch.",
  },
];

const useCases = ["Instagram Reels captions", "YouTube Shorts captions", "TikTok captions", "Podcast clips", "Talking-head videos", "Agency client videos"];

export default function HomePage() {
  return (
    <MarketingLayout>
      <SoftwareJsonLd />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Organization",
          name: siteConfig.companyName,
          url: siteConfig.domain,
          brand: siteConfig.siteName,
          contactPoint: {
            "@type": "ContactPoint",
            email: siteConfig.contactEmail,
            contactType: "customer support",
          },
        }}
      />
      <section className="marketing-hero">
        <div className="marketing-hero-copy">
          <p className="marketing-eyebrow">Auto Subtitle Generator</p>
          <h1>Auto Subtitle Generator for Reels, Shorts & TikToks</h1>
          <p>Generate accurate subtitles, create animated word-by-word captions, edit timing, and export ready-to-post videos.</p>
          <CtaRow />
        </div>
        <div className="marketing-product-shot" aria-label="Caption editor preview">
          <div className="phone-frame">
            <div className="video-preview">
              <span>YOU SAID IT</span>
              <strong>MAKE IT READABLE</strong>
            </div>
          </div>
          <div className="timeline-preview">
            <span />
            <span />
            <span />
          </div>
        </div>
      </section>

      <section className="marketing-trust-strip" aria-label="Audience">
        For creators, editors, agencies, podcasts and short-form teams
      </section>

      <section className="marketing-section">
        <SectionHeader eyebrow="How it works" title="From raw clip to subtitled export" />
        <ol className="marketing-workflow">
          <li>Upload your video</li>
          <li>Generate AI captions</li>
          <li>Edit timing and styles</li>
          <li>Export your final video</li>
        </ol>
      </section>

      <section className="marketing-section">
        <SectionHeader
          eyebrow="Features"
          title="Subtitle and caption tools for short-form production"
          body="Huygen Caps combines auto subtitle generation with the animated caption controls creators need before a video goes live."
        />
        <FeatureGrid items={features} />
      </section>

      <section className="marketing-section">
        <SectionHeader eyebrow="Use cases" title="Make captions for every short-form channel" />
        <div className="marketing-bullet-grid">
          {useCases.map((useCase) => (
            <div key={useCase}>{useCase}</div>
          ))}
        </div>
      </section>

      <section className="marketing-section seo-copy">
        <h2>Huygen Caps is an auto subtitle generator and AI caption maker for creator teams</h2>
        <p>
          Huygen Caps helps short-form creators generate subtitles, review captions, adjust word-level timing and export
          videos with captions burned in. It is built for the practical moments between a rough transcript and a video that
          is ready to post.
        </p>
        <p>
          Start with the <Link href="/auto-subtitle-generator">auto subtitle generator</Link>, compare the{" "}
          <Link href="/ai-caption-generator">AI caption generator</Link>, or explore workflows for{" "}
          <Link href="/captions-for-reels">Reels</Link>, <Link href="/youtube-shorts-caption-generator">YouTube Shorts</Link>{" "}
          and <Link href="/tiktok-caption-generator">TikTok captions</Link>.
        </p>
      </section>

      <FaqSection faqs={homeFaqs} pagePath="/" />

      <section className="marketing-final-cta">
        <h2>Create captions that are fast, editable and export-ready</h2>
        <p>Upload a video, generate captions, review the timing and export your final clip.</p>
        <Link className="marketing-button primary" href={siteConfig.appPath}>
          Start Creating Captions
        </Link>
      </section>
    </MarketingLayout>
  );
}
