import Link from "next/link";
import { absoluteUrl, siteConfig } from "@/config/site";
import JsonLd from "./JsonLd";

export function CtaRow() {
  return (
    <div className="marketing-cta-row">
      <Link className="marketing-button primary" href={siteConfig.appPath}>
        Start Creating Captions
      </Link>
      <Link className="marketing-button secondary" href="/pricing">
        View Pricing
      </Link>
    </div>
  );
}

export function SectionHeader({ eyebrow, title, body }: { eyebrow?: string; title: string; body?: string }) {
  return (
    <div className="marketing-section-header">
      {eyebrow ? <p className="marketing-eyebrow">{eyebrow}</p> : null}
      <h2>{title}</h2>
      {body ? <p>{body}</p> : null}
    </div>
  );
}

export function FeatureGrid({ items }: { items: { title: string; body: string }[] }) {
  return (
    <div className="marketing-grid">
      {items.map((item) => (
        <article className="marketing-card" key={item.title}>
          <h3>{item.title}</h3>
          <p>{item.body}</p>
        </article>
      ))}
    </div>
  );
}

export function FaqSection({ faqs, pagePath }: { faqs: { question: string; answer: string }[]; pagePath: string }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };

  return (
    <section className="marketing-section" id="faq">
      <JsonLd data={data} />
      <SectionHeader eyebrow="FAQ" title="Questions creators ask before exporting" />
      <div className="marketing-faq-list">
        {faqs.map((faq) => (
          <details key={faq.question}>
            <summary>{faq.question}</summary>
            <p>{faq.answer}</p>
          </details>
        ))}
      </div>
      <p className="marketing-related-note">
        Need help with a specific project? <Link href={`/contact?from=${encodeURIComponent(pagePath)}`}>Contact Huygen Caps</Link>.
      </p>
    </section>
  );
}

export function BreadcrumbJsonLd({ items }: { items: { name: string; path: string }[] }) {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: items.map((item, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: item.name,
          item: absoluteUrl(item.path),
        })),
      }}
    />
  );
}

export function SoftwareJsonLd({ path = "/" }: { path?: string }) {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: siteConfig.siteName,
        applicationCategory: "MultimediaApplication",
        operatingSystem: "Web",
        url: absoluteUrl(path),
        description: siteConfig.defaultDescription,
        publisher: {
          "@type": "Organization",
          name: siteConfig.companyName,
          url: siteConfig.domain,
        },
      }}
    />
  );
}

