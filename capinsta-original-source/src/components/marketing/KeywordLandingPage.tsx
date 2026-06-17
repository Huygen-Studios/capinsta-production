import Link from "next/link";
import { siteConfig } from "@/config/site";
import { BreadcrumbJsonLd, CtaRow, FaqSection, SoftwareJsonLd } from "./PageSections";

interface KeywordPage {
  slug: string;
  keyword: string;
  h1: string;
  intro: string;
  audience: string;
  workflow: string[];
  features: string[];
  related: string[];
  faqs: string[][];
}

function titleFromPath(path: string) {
  return path
    .replace("/", "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function KeywordLandingPage({ page }: { page: KeywordPage }) {
  const path = `/${page.slug}`;
  const faqs = page.faqs.map(([question, answer]) => ({ question, answer }));

  return (
    <>
      <SoftwareJsonLd path={path} />
      <BreadcrumbJsonLd items={[{ name: "Home", path: "/" }, { name: page.h1, path }]} />
      <section className="marketing-hero compact">
        <p className="marketing-eyebrow">{page.keyword}</p>
        <h1>{page.h1}</h1>
        <p>{page.intro}</p>
        <CtaRow />
      </section>
      <section className="marketing-section two-column">
        <div>
          <p className="marketing-eyebrow">Who it is for</p>
          <h2>Made for creator publishing workflows</h2>
          <p>{page.audience}</p>
        </div>
        <div className="marketing-panel">
          <h2>Workflow</h2>
          <ol className="marketing-steps">
            {page.workflow.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      </section>
      <section className="marketing-section">
        <div className="marketing-section-header">
          <p className="marketing-eyebrow">Features</p>
          <h2>Caption controls without a heavy editing setup</h2>
        </div>
        <div className="marketing-bullet-grid">
          {page.features.map((feature) => (
            <div key={feature}>{feature}</div>
          ))}
        </div>
      </section>
      <section className="marketing-section seo-copy">
        <h2>Use Huygen Caps as your {page.keyword}</h2>
        <p>
          Huygen Caps keeps the caption process practical: generate a draft, check the words, tune subtitle timing and export
          when the video is ready. It is built for teams that want fast AI-assisted captions while keeping human review in
          the workflow.
        </p>
        <p>
          Explore related workflows for{" "}
          {page.related.map((href, index) => (
            <span key={href}>
              <Link href={href}>{titleFromPath(href)}</Link>
              {index < page.related.length - 1 ? ", " : "."}
            </span>
          ))}
        </p>
      </section>
      <FaqSection faqs={faqs} pagePath={path} />
      <section className="marketing-final-cta">
        <h2>Start building captioned videos with {siteConfig.siteName}</h2>
        <p>Generate, review, style and export captions from one focused workspace.</p>
        <Link className="marketing-button primary" href={siteConfig.appPath}>
          Start Creating Captions
        </Link>
      </section>
    </>
  );
}

