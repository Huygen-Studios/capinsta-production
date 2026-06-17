import type { Metadata } from "next";
import LegalPage from "@/components/marketing/LegalPage";
import { createMetadata } from "@/config/site";

export const metadata: Metadata = createMetadata({
  title: "Cookie Policy - Huygen Caps",
  description: "Learn how Huygen Caps may use cookies, local storage and analytics technologies.",
  path: "/cookie-policy",
});

export default function CookiePolicyPage() {
  return (
    <LegalPage
      title="Cookie Policy - Huygen Caps"
      intro="This Cookie Policy explains how Huygen Caps may use cookies, browser storage and similar technologies."
      sections={[
        { title: "Essential cookies", body: "Essential cookies may be used for authentication, security, session continuity and basic product operation." },
        { title: "Analytics cookies", body: "Analytics cookies may be used to understand traffic, errors and feature usage if analytics tools are enabled." },
        { title: "Preference storage", body: "Local storage may save editor preferences such as theme, panel state and other product settings." },
        { title: "Authentication/session cookies", body: "If accounts are enabled, session cookies or tokens may keep users signed in securely." },
        { title: "How users can control cookies", body: "Users can manage cookies through browser settings, although disabling essential storage may break parts of the app." },
      ]}
    />
  );
}

