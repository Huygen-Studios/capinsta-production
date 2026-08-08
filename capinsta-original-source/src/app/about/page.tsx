import type { Metadata } from "next";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import JsonLd from "@/components/marketing/JsonLd";
import { createMetadata, siteConfig } from "@/config/site";

export const metadata: Metadata = createMetadata({
  title: "About Huygen Caps - AI Caption Generator by Huygen Studios",
  description: "Learn about Huygen Caps, an AI caption generator built by Huygen Studios for creators, editors and short-form video teams.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <MarketingLayout>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Organization",
          name: siteConfig.companyName,
          url: siteConfig.domain,
          email: siteConfig.contactEmail,
          brand: { "@type": "Brand", name: siteConfig.siteName },
        }}
      />
      <section className="marketing-hero compact">
        <p className="marketing-eyebrow">About</p>
        <h1>About Huygen Caps</h1>
        <p>Huygen Caps is an AI caption generator built by Huygen Studios for creators, editors and short-form video teams.</p>
      </section>
      <section className="marketing-section two-column">
        <div>
          <h2>Built by Huygen Studios</h2>
          <p>
            Huygen Caps exists to help creators make accurate, stylish and export-ready captions faster. The product focuses
            on short-form video, AI-assisted editing and subtitle timing workflows that still leave room for human review.
          </p>
        </div>
        <div className="marketing-panel">
          <h2>Focus areas</h2>
          <ul>
            <li>Animated captions for short videos</li>
            <li>Subtitle timing and review tools</li>
            <li>Creator-friendly exports</li>
            <li>AI-assisted editing workflows</li>
          </ul>
        </div>
      </section>
    </MarketingLayout>
  );
}

