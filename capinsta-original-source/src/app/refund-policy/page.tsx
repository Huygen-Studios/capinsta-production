import type { Metadata } from "next";
import LegalPage from "@/components/marketing/LegalPage";
import { createMetadata } from "@/config/site";

export const metadata: Metadata = createMetadata({
  title: "Refund Policy - Huygen Caps",
  description: "Read the Huygen Caps Refund Policy for subscriptions, credits, exports, failed payments and billing issues.",
  path: "/refund-policy",
});

export default function RefundPolicyPage() {
  return (
    <LegalPage
      title="Refund Policy - Huygen Caps"
      intro="This Refund Policy provides placeholder launch terms for subscriptions, credits and billing issues. Confirm final rules before accepting payments."
      sections={[
        { title: "Subscription refunds placeholder", body: "Define whether monthly or yearly subscription payments are refundable, partially refundable or non-refundable after use." },
        { title: "Credit-based usage placeholder", body: "Define whether unused credits expire, roll over or can be refunded after purchase." },
        { title: "Failed exports handling placeholder", body: "Define whether failed exports restore credits automatically, require support review or qualify for billing adjustment." },
        { title: "Duplicate charges", body: "Users should contact support with billing details if they believe they were charged twice for the same plan or credit purchase." },
        { title: "Cancellation rules", body: "Subscriptions should remain active through the paid period unless production billing rules state otherwise." },
      ]}
    />
  );
}

