import type { Metadata } from "next";
import Link from "next/link";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import JsonLd from "@/components/marketing/JsonLd";
import { absoluteUrl, createMetadata, siteConfig } from "@/config/site";

export const metadata: Metadata = createMetadata({
  title: "Contact Huygen Caps",
  description: "Contact Huygen Caps for support, product questions, agency plans, billing help or partnership inquiries.",
  path: "/contact",
});

const categories = ["Product support", "Billing", "Agency/team plans", "Partnerships", "Bug reports"];

export default function ContactPage() {
  return (
    <MarketingLayout>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ContactPage",
          name: "Contact Huygen Caps",
          url: absoluteUrl("/contact"),
          mainEntity: {
            "@type": "Organization",
            name: siteConfig.companyName,
            email: siteConfig.contactEmail,
          },
        }}
      />
      <section className="marketing-hero compact">
        <p className="marketing-eyebrow">Contact</p>
        <h1>Contact Huygen Caps</h1>
        <p>Get help with product questions, agency plans, billing, partnerships or bug reports.</p>
        <a className="marketing-button primary" href={`mailto:${siteConfig.contactEmail}`}>
          Email {siteConfig.contactEmail}
        </a>
      </section>
      <section className="marketing-section">
        <div className="marketing-bullet-grid">
          {categories.map((category) => (
            <div key={category}>{category}</div>
          ))}
        </div>
        <p className="marketing-related-note">
          For privacy or deletion requests, visit <Link href="/data-deletion">Data Deletion</Link>.
        </p>
      </section>
    </MarketingLayout>
  );
}
