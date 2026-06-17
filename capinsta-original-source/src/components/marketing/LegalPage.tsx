import Link from "next/link";
import { legalUpdatedDate, siteConfig } from "@/config/site";
import MarketingLayout from "./MarketingLayout";

export interface LegalSection {
  title: string;
  body: string;
}

export default function LegalPage({ title, intro, sections }: { title: string; intro: string; sections: LegalSection[] }) {
  return (
    <MarketingLayout>
      <article className="legal-page">
        <p className="marketing-eyebrow">Legal</p>
        <h1>{title}</h1>
        <p className="legal-updated">Last updated: {legalUpdatedDate}</p>
        <p>{intro}</p>
        <p className="legal-disclaimer">
          This template is provided for product launch readiness and should be reviewed by a qualified legal professional.
        </p>
        {sections.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            <p>{section.body}</p>
          </section>
        ))}
        <section>
          <h2>Contact</h2>
          <p>
            Questions can be sent to <a href={`mailto:${siteConfig.contactEmail}`}>{siteConfig.contactEmail}</a>. You can also
            visit the <Link href="/contact">Contact page</Link>.
          </p>
        </section>
      </article>
    </MarketingLayout>
  );
}

