import type { Metadata } from "next";
import LegalPage from "@/components/marketing/LegalPage";
import { createMetadata } from "@/config/site";

export const metadata: Metadata = createMetadata({
  title: "Disclaimer - Huygen Caps",
  description: "Read the Huygen Caps disclaimer for AI-generated captions, transcription accuracy, video exports and user responsibilities.",
  path: "/disclaimer",
});

export default function DisclaimerPage() {
  return (
    <LegalPage
      title="Disclaimer - Huygen Caps"
      intro="Huygen Caps is an AI-assisted caption workflow. Users remain responsible for reviewing captions, exports and rights before publishing."
      sections={[
        { title: "AI captions may not be 100% accurate", body: "Generated captions can contain transcription errors, timing issues, missing words or incorrect language handling." },
        { title: "Review before publishing", body: "Users should review and correct captions before publishing videos to any platform." },
        { title: "No platform compliance guarantee", body: "Huygen Caps does not guarantee that a video, caption style or export will satisfy any platform's rules, accessibility requirements or monetization policies." },
        { title: "User content and rights", body: "Users are responsible for ensuring they have the rights to upload, process, edit and publish their content." },
      ]}
    />
  );
}

