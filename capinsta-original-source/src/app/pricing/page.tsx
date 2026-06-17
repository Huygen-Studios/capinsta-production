import type { Metadata } from "next";
import Link from "next/link";
import MarketingLayout from "@/components/marketing/MarketingLayout";
import JsonLd from "@/components/marketing/JsonLd";
import { FaqSection } from "@/components/marketing/PageSections";
import { absoluteUrl, createMetadata, pricingPlans, siteConfig } from "@/config/site";

export const metadata: Metadata = createMetadata({
  title: "Pricing - Huygen Caps Auto Subtitle Generator",
  description: "Choose a Huygen Caps plan for auto subtitles, animated captions, short-form video exports and creator workflows.",
  path: "/pricing",
});

const pricingFaqs = [
  {
    question: "Are these final prices?",
    answer: "Starter is Rs. 500 per month for 10 captioned videos, Creator is Rs. 1000 per month for 30 videos, and Custom plans are available for higher-volume teams. Confirm billing rules before payments go live.",
  },
  {
    question: "Can I cancel a subscription?",
    answer: "Cancellation rules should be confirmed in the billing system. The launch policy should make cancellation terms clear before checkout.",
  },
  {
    question: "How do refunds work?",
    answer: "Refund terms are described in the Refund Policy and should be reviewed before paid launch.",
  },
  {
    question: "Do export credits expire?",
    answer: "Monthly video limits are plan-based. Confirm whether unused monthly limits roll over before production checkout goes live.",
  },
  {
    question: "What happens if an export fails?",
    answer: "Failed export handling should be defined before launch, including whether credits are restored or support review is required.",
  },
];

export default function PricingPage() {
  return (
    <MarketingLayout>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Product",
          name: siteConfig.siteName,
          description: "Auto subtitle generator and AI caption maker for short-form videos.",
          brand: { "@type": "Brand", name: siteConfig.siteName },
          offers: pricingPlans.map((plan) => ({
            "@type": "Offer",
            name: plan.name,
            priceCurrency: "INR",
            url: absoluteUrl("/pricing"),
            availability: "https://schema.org/PreOrder",
          })),
        }}
      />
      <section className="marketing-hero compact">
        <p className="marketing-eyebrow">Pricing</p>
        <h1>Pricing for auto subtitles, animated captions and short-form exports</h1>
        <p>Start with Rs. 500 per month for 10 captioned videos. Every listed pack exports without a watermark.</p>
      </section>
      <section className="marketing-section">
        <div className="pricing-grid">
          {pricingPlans.map((plan) => (
            <article className="pricing-card" key={plan.name}>
              <h2>{plan.name}</h2>
              <p>{plan.description}</p>
              <strong>{plan.price}</strong>
              <ul>
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <Link className="marketing-button primary" href={plan.name === "Custom" ? "/contact" : siteConfig.appPath}>
                {plan.cta}
              </Link>
            </article>
          ))}
        </div>
        <p className="marketing-related-note">
          Billing launch notes: confirm payment provider setup, duration limits, storage limits, rollover rules and refund terms before checkout. No watermark is included in every listed pack.
        </p>
      </section>
      <FaqSection faqs={pricingFaqs} pagePath="/pricing" />
      <section className="marketing-section seo-copy">
        <p>
          By choosing a plan, users should be able to review the <Link href="/terms-of-service">Terms of Service</Link>,{" "}
          <Link href="/privacy-policy">Privacy Policy</Link> and <Link href="/refund-policy">Refund Policy</Link>.
        </p>
      </section>
    </MarketingLayout>
  );
}
