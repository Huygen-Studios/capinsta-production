import type { Metadata } from "next";
import LegalPage from "@/components/marketing/LegalPage";
import { createMetadata } from "@/config/site";

export const metadata: Metadata = createMetadata({
  title: "Terms of Service - Huygen Caps",
  description: "Read the Huygen Caps Terms of Service for usage rules, accounts, uploads, AI-generated captions, exports, payments and limitations.",
  path: "/terms-of-service",
});

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service - Huygen Caps"
      intro="These launch-ready terms describe expected rules for using Huygen Caps. They must be reviewed and adapted before paid production launch."
      sections={[
        { title: "Acceptance of terms", body: "By using Huygen Caps, users agree to the applicable terms, policies and any plan-specific rules shown during signup or checkout." },
        { title: "Description of service", body: "Huygen Caps provides AI-assisted caption generation, subtitle timing, caption styling and export workflows for video projects." },
        { title: "User accounts", body: "Users are responsible for keeping account credentials secure and for activity that occurs in their workspace." },
        { title: "User uploaded content", body: "Users keep ownership of their uploaded videos and project content, but grant the rights needed to process, store, preview and export captions." },
        { title: "User responsibilities", body: "Users must have rights to uploaded content and must review captions, exports and platform requirements before publishing." },
        { title: "AI-generated output disclaimer", body: "AI-generated captions may be inaccurate, incomplete or unsuitable without review. Huygen Caps does not guarantee perfect transcription." },
        { title: "Prohibited uses", body: "Users may not upload unlawful content, infringe rights, abuse infrastructure, bypass limits or use the service in ways that harm others." },
        { title: "Payments and subscriptions", body: "Paid plan details, renewal terms, taxes, credits and limits must match the production billing provider and checkout flow." },
        { title: "Refunds link", body: "Refund handling is described in the Refund Policy and should be consistent with payment provider rules." },
        { title: "Intellectual property", body: "Huygen Caps, brand assets, software, design and documentation belong to Huygen Studios or its licensors." },
        { title: "Service availability", body: "The service may change, pause or experience downtime. No uninterrupted availability is guaranteed." },
        { title: "Termination", body: "Accounts may be suspended or terminated for policy violations, non-payment or harmful use." },
        { title: "Limitation of liability", body: "Liability limits must be reviewed by counsel and aligned with applicable law before launch." },
      ]}
    />
  );
}

