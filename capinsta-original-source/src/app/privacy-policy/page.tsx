import type { Metadata } from "next";
import LegalPage from "@/components/marketing/LegalPage";
import { createMetadata } from "@/config/site";

export const metadata: Metadata = createMetadata({
  title: "Privacy Policy - Huygen Caps",
  description: "Read the Huygen Caps Privacy Policy to understand how uploaded videos, captions, account data and usage information may be handled.",
  path: "/privacy-policy",
});

export default function PrivacyPolicyPage() {
  return (
    <LegalPage
      title="Privacy Policy - Huygen Caps"
      intro="This Privacy Policy explains how Huygen Caps may collect, use and protect information connected to accounts, uploaded media, generated captions and product usage."
      sections={[
        { title: "Introduction", body: "Huygen Caps is operated by Huygen Studios. Production privacy terms should match the final hosting, analytics, storage, transcription and billing providers." },
        { title: "Information we collect", body: "We may collect account details, contact information, uploaded videos, media files, captions, subtitles, project settings, usage events and support messages." },
        { title: "Account information", body: "If accounts are enabled, we may process names, email addresses, authentication identifiers and workspace information needed to provide the service." },
        { title: "Uploaded videos and media files", body: "Videos and related media may be processed to generate captions, render previews and export captioned files. Retention periods must be finalized before launch." },
        { title: "Generated captions/subtitles", body: "Generated captions, subtitle timing data and edits may be stored with projects so users can review, edit and export their work." },
        { title: "Payment and billing data", body: "Payment information should be handled by payment providers. Huygen Caps may store billing status, plan level, invoices or transaction references as needed." },
        { title: "Usage and analytics data", body: "We may use analytics to understand product performance, errors, feature usage and conversion funnels. Analytics providers should be disclosed before launch." },
        { title: "Cookies/local storage", body: "The app may use cookies or local storage for authentication, preferences, session state, editor settings and analytics where configured." },
        { title: "How we use information", body: "Information may be used to provide caption generation, manage accounts, process exports, improve reliability, respond to support and protect the service." },
        { title: "AI processing and transcription providers", body: "Uploaded audio or video may be sent to AI, transcription or processing providers to generate captions. Provider names and retention terms should be confirmed." },
        { title: "File storage and retention", body: "Media files, generated assets and exports may be stored temporarily or with user projects. Add production retention timelines after infrastructure is finalized." },
        { title: "Data sharing with service providers", body: "We may share data with hosting, storage, payment, analytics, transcription, email and support providers only as needed to operate the service." },
        { title: "Security", body: "Reasonable safeguards should be used to protect account data and uploaded media, but no online service can guarantee perfect security." },
        { title: "User rights and deletion requests", body: "Users may request access, correction or deletion where applicable. See the Data Deletion page for launch instructions." },
        { title: "Children's privacy", body: "Huygen Caps is not intended for children under the minimum age required by applicable law." },
        { title: "International users", body: "Users outside the operating country understand that data may be processed in other regions depending on provider infrastructure." },
        { title: "Changes to policy", body: "This policy may be updated as the product, providers and legal requirements change." },
      ]}
    />
  );
}

