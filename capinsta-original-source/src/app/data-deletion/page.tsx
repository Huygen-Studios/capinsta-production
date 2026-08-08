import type { Metadata } from "next";
import LegalPage from "@/components/marketing/LegalPage";
import { createMetadata, siteConfig } from "@/config/site";

export const metadata: Metadata = createMetadata({
  title: "Data Deletion - Huygen Caps",
  description: "Request deletion of your Huygen Caps account data, uploaded media, captions and related project information.",
  path: "/data-deletion",
});

export default function DataDeletionPage() {
  return (
    <LegalPage
      title="Data Deletion - Huygen Caps"
      intro={`To request deletion of Huygen Caps data, email ${siteConfig.contactEmail} from the address connected to your account.`}
      sections={[
        { title: "How to request deletion", body: `Send a deletion request to ${siteConfig.contactEmail} with your account email and a short description of the data you want deleted.` },
        { title: "What data can be deleted", body: "Deletion may include account data, uploaded media, generated captions, project files, exports and related workspace information where applicable." },
        { title: "Data that may be retained", body: "Some billing, fraud prevention, security, tax, legal or backup records may be retained where required or reasonably necessary." },
        { title: "Expected processing timeline placeholder", body: "Add a production deletion timeline before launch, such as 30 days, subject to identity verification and legal retention requirements." },
      ]}
    />
  );
}
