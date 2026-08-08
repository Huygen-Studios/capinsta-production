export type ComparisonStatus = "Supported" | "Planned" | "Verify before publishing" | "Not available";

export interface CompetitorConfig {
  name: string;
  slug: string;
  officialWebsite: string;
  pageTitle: string;
  metaDescription: string;
  h1: string;
  intro: string;
  bestFor: string[];
  comparisonAngles: string[];
  limitationsToVerify: string[];
  huygenCapsAdvantages: string[];
  switchingSteps: string[];
  faqItems: { question: string; answer: string }[];
  disclaimer: string;
}

const featureLabels = [
  "Auto subtitle generation",
  "Word-level caption editing",
  "Animated captions",
  "Short-form video presets",
  "Reels/Shorts/TikTok workflow",
  "Subtitle timing editor",
  "Burned-in caption export",
  "SRT/VTT export if supported",
  "Brand styling/presets",
  "Team/agency workflow if supported",
];

export const comparisonFeatures = featureLabels.map((label) => ({
  label,
  huygenCaps: label === "SRT/VTT export if supported" || label === "Team/agency workflow if supported" ? "Verify before publishing" : "Supported",
  competitor: "Verify before publishing",
})) satisfies { label: string; huygenCaps: ComparisonStatus; competitor: ComparisonStatus }[];

function disclaimer(name: string) {
  return `Huygen Caps is not affiliated with, endorsed by, or sponsored by ${name}. All trademarks belong to their respective owners.`;
}

export const competitors: CompetitorConfig[] = [
  {
    name: "VEED",
    slug: "veed",
    officialWebsite: "https://www.veed.io/",
    pageTitle: "VEED Alternative for Auto Subtitles & Animated Captions | Huygen Caps",
    metaDescription:
      "Compare Huygen Caps with VEED for auto subtitles, animated captions, word-level timing and short-form video exports.",
    h1: "VEED Alternative for Auto Subtitles & Animated Captions",
    intro:
      "VEED is widely known as an online video editing platform, so creators often compare it when they need subtitles, captions and fast social edits. Huygen Caps is built with a narrower focus: generate subtitles, refine word-level caption timing, style animated captions and export short-form clips for Reels, Shorts and TikToks.",
    bestFor: ["Creators comparing a broad online editor with a focused caption workflow", "Teams that care about animated captions and subtitle timing", "Short-form editors who want a lightweight path from upload to export"],
    comparisonAngles: ["General online editing versus caption-first workflow", "Subtitle generation followed by manual review", "Animated caption styles for social clips", "Burned-in captions for ready-to-post exports"],
    limitationsToVerify: ["VEED plan limits, watermark rules and export options must be checked on VEED's official website before publishing detailed claims.", "Huygen Caps SRT/VTT export availability must be confirmed before launch copy states support."],
    huygenCapsAdvantages: ["Focused on auto subtitles and animated creator captions rather than every editing job", "Clear workflow for word-by-word captions, timing review and burned-in short-form exports", "Pricing starts at Rs. 500 with no watermark across listed packs"],
    switchingSteps: ["Export or collect your source video", "Upload it to Huygen Caps", "Generate auto subtitles", "Review timing and caption text", "Choose an animated caption style", "Export the captioned short-form video"],
    faqItems: [
      { question: "Is Huygen Caps an official VEED alternative?", answer: "No. Huygen Caps is independent and is not affiliated with, endorsed by, or sponsored by VEED." },
      { question: "Why compare Huygen Caps with VEED?", answer: "Creators searching for a VEED alternative may want a more focused auto subtitle generator for animated captions and short-form exports." },
      { question: "Can Huygen Caps replace a full video editor?", answer: "Huygen Caps is focused on subtitles, timing and animated captions. Keep a full editor for broader cutting, compositing or advanced production work." },
    ],
    disclaimer: disclaimer("VEED"),
  },
  {
    name: "Kapwing",
    slug: "kapwing",
    officialWebsite: "https://www.kapwing.com/",
    pageTitle: "Kapwing Alternative for Animated Captions & Auto Subtitles | Huygen Caps",
    metaDescription:
      "Compare Huygen Caps with Kapwing for animated captions, auto subtitle generation, timing edits and short-form video exports.",
    h1: "Kapwing Alternative for Auto Subtitles & Animated Captions",
    intro:
      "Kapwing is a popular browser-based creative suite for online video and content editing. If your main job is creating subtitle-led short-form videos, Huygen Caps offers a focused path for auto subtitle generation, word-by-word captions, timing cleanup and burned-in caption exports.",
    bestFor: ["Creators searching for a Kapwing alternative for caption-heavy clips", "Editors producing recurring social videos", "Teams that want caption styling and timing review in the same workflow"],
    comparisonAngles: ["Creative suite breadth versus subtitle-first production", "Word-level timing review for creator captions", "Animated captions for Reels, Shorts and TikToks", "Pricing and monthly video limits for caption workflows"],
    limitationsToVerify: ["Kapwing feature limits, current plan names and watermark behavior must be verified on Kapwing's official website.", "Any direct export-format comparison must be verified in both products before publishing."],
    huygenCapsAdvantages: ["Built around subtitle generation and animated captions as the primary workflow", "Simple no-watermark pricing across Starter, Creator and Custom packs", "Internal links and pages target creators looking for captions for Reels, YouTube Shorts and TikTok captions"],
    switchingSteps: ["Start with a finished or nearly finished clip", "Upload to Huygen Caps", "Generate subtitles", "Correct words and timing", "Apply a short-form caption preset", "Export and review before publishing"],
    faqItems: [
      { question: "Is Huygen Caps affiliated with Kapwing?", answer: "No. Huygen Caps is independent and is not affiliated with, endorsed by, or sponsored by Kapwing." },
      { question: "Who should consider Huygen Caps instead of Kapwing?", answer: "Creators who mainly need an auto subtitle generator, AI caption generator and animated caption workflow may prefer a focused tool." },
      { question: "Does this page make claims about Kapwing pricing?", answer: "No. Pricing and plan details for competitors should be verified on their official websites before making direct claims." },
    ],
    disclaimer: disclaimer("Kapwing"),
  },
  {
    name: "HappyScribe",
    slug: "happyscribe",
    officialWebsite: "https://www.happyscribe.com/",
    pageTitle: "HappyScribe Alternative for Short-Form Auto Subtitles | Huygen Caps",
    metaDescription:
      "Compare Huygen Caps with HappyScribe for auto subtitles, animated captions, word-level timing and creator video exports.",
    h1: "HappyScribe Alternative for Auto Subtitles & Animated Captions",
    intro:
      "HappyScribe is often considered by users who need transcription and subtitle workflows. Huygen Caps is positioned for creators who want to move from generated subtitles into animated captions and burned-in short-form video exports for social platforms.",
    bestFor: ["Creators who need subtitles as part of a visual short-form edit", "Podcast teams turning clips into captioned videos", "Editors who want reviewable subtitle timing before export"],
    comparisonAngles: ["Transcription/subtitle workflow versus animated caption export workflow", "Podcast and talking-head clip production", "Subtitle timing editor needs", "Creator packaging for Reels, Shorts and TikToks"],
    limitationsToVerify: ["HappyScribe transcription languages, human-service options, export formats and pricing must be verified before detailed comparison.", "Huygen Caps language availability must be confirmed before publishing language-specific claims."],
    huygenCapsAdvantages: ["Designed for captioned video exports rather than transcript delivery alone", "Includes animated captions and word-by-word caption positioning in the product story", "Offers creator-focused pricing with no watermark in listed packs"],
    switchingSteps: ["Prepare the clip you want to caption", "Upload it to Huygen Caps", "Generate subtitles", "Review words, punctuation and timing", "Select animated caption styling", "Export the final short-form video"],
    faqItems: [
      { question: "Is Huygen Caps a transcription service like HappyScribe?", answer: "Huygen Caps is primarily a creator-focused auto subtitle generator and animated caption editor for video exports." },
      { question: "Is Huygen Caps affiliated with HappyScribe?", answer: "No. Huygen Caps is independent and is not affiliated with, endorsed by, or sponsored by HappyScribe." },
      { question: "Should I use a transcription tool or Huygen Caps?", answer: "Use the tool that matches the job: transcript delivery, subtitle files or captioned short-form video exports." },
    ],
    disclaimer: disclaimer("HappyScribe"),
  },
  {
    name: "Clideo",
    slug: "clideo",
    officialWebsite: "https://clideo.com/",
    pageTitle: "Clideo Alternative for Auto Subtitles & Creator Captions | Huygen Caps",
    metaDescription:
      "Compare Huygen Caps with Clideo for auto subtitle generation, animated captions, timing edits and social video exports.",
    h1: "Clideo Alternative for Auto Subtitles & Animated Captions",
    intro:
      "Clideo is known for simple online video utilities. Huygen Caps is intended for creators who want a dedicated auto subtitle generator with animated captions, word-level review and short-form export workflows.",
    bestFor: ["Users moving from simple video utilities into repeat caption production", "Creators who need captions for Reels and TikTok videos", "Small teams that want a caption-first workflow"],
    comparisonAngles: ["Utility-style editing versus repeat subtitle production", "Animated captions and word-by-word captions", "Timing review before burned-in export", "No-watermark pack positioning"],
    limitationsToVerify: ["Clideo current subtitle features, limits and watermark behavior must be verified on its official website.", "Huygen Caps production export limits must match the billing system before launch."],
    huygenCapsAdvantages: ["Built around auto subtitles, AI captions and short-form caption styling", "No watermark in Starter, Creator and Custom packs", "Straight path from upload to subtitles, timing fixes and export"],
    switchingSteps: ["Download your source video", "Open Huygen Caps", "Generate subtitles", "Edit caption text and timing", "Choose visual caption styling", "Export the completed clip"],
    faqItems: [
      { question: "Is Huygen Caps affiliated with Clideo?", answer: "No. Huygen Caps is independent and is not affiliated with, endorsed by, or sponsored by Clideo." },
      { question: "Why would someone compare Huygen Caps with Clideo?", answer: "Both may appear during searches for online video and subtitle tools, but Huygen Caps is focused on creator caption workflows." },
      { question: "Can Huygen Caps make animated captions?", answer: "Yes. Animated captions and word-by-word caption workflows are part of the Huygen Caps positioning." },
    ],
    disclaimer: disclaimer("Clideo"),
  },
  {
    name: "Clipchamp",
    slug: "clipchamp",
    officialWebsite: "https://clipchamp.com/",
    pageTitle: "Clipchamp Subtitle Generator Alternative | Huygen Caps",
    metaDescription:
      "Compare Huygen Caps with Clipchamp for auto subtitles, animated captions, word-level timing and social video exports.",
    h1: "Clipchamp Alternative for Auto Subtitles & Animated Captions",
    intro:
      "Clipchamp is a recognizable video editor, especially for users who want a general editing workspace. Huygen Caps is narrower: it is built to help creators generate subtitles, turn them into animated captions and export short-form clips with timing reviewed.",
    bestFor: ["Creators who already have an edit and need caption finishing", "Teams producing subtitle-heavy Reels, Shorts and TikToks", "Editors comparing general video editing with caption-first tools"],
    comparisonAngles: ["General editor versus caption finishing workflow", "Subtitle timing review", "Animated word-by-word captions", "Burned-in export for social platforms"],
    limitationsToVerify: ["Clipchamp subtitle features, export limits, plan rules and watermark behavior must be checked on Clipchamp's official website.", "Any OS-specific or Microsoft-account claims must be verified before publishing."],
    huygenCapsAdvantages: ["Caption-first workflow for finished clips and short-form publishing", "Animated caption styles and word-level timing language are central to the product", "No watermark across listed Huygen Caps packs"],
    switchingSteps: ["Finish your rough cut in your preferred editor", "Upload the clip to Huygen Caps", "Generate auto subtitles", "Review and style captions", "Export the captioned video for posting"],
    faqItems: [
      { question: "Is Huygen Caps a full Clipchamp replacement?", answer: "Not for every editing job. Huygen Caps is focused on auto subtitles, animated captions and captioned exports." },
      { question: "Is Huygen Caps affiliated with Clipchamp?", answer: "No. Huygen Caps is independent and is not affiliated with, endorsed by, or sponsored by Clipchamp." },
      { question: "Who is this alternative page for?", answer: "It is for users comparing subtitle generator and animated caption workflows, not for users looking for an official Clipchamp page." },
    ],
    disclaimer: disclaimer("Clipchamp"),
  },
  {
    name: "Canva Captions",
    slug: "canva-captions",
    officialWebsite: "https://www.canva.com/",
    pageTitle: "Canva Captions Alternative for Animated Subtitles | Huygen Caps",
    metaDescription:
      "Compare Huygen Caps with Canva caption workflows for auto subtitles, animated captions and short-form video exports.",
    h1: "Canva Captions Alternative for Auto Subtitles & Animated Captions",
    intro:
      "Canva is a broad design platform used for social posts, presentations and quick visual content. Huygen Caps is built for one narrower job: generate subtitles, edit timing, create animated captions and export captioned short-form videos.",
    bestFor: ["Creators who already have brand visuals but need captioned video exports", "Editors focused on Reels, Shorts and TikTok captions", "Teams comparing design-first tools with subtitle-first workflows"],
    comparisonAngles: ["Design platform breadth versus caption workflow focus", "Animated captions for speaking videos", "Subtitle timing editor needs", "Burned-in export preparation"],
    limitationsToVerify: ["Canva caption features, plan limits and export behavior must be verified on Canva's official website.", "Any comparison with Canva templates or brand kits must be verified before publishing."],
    huygenCapsAdvantages: ["Specialized around auto subtitle generation and word-by-word captions", "Designed for talking-head videos, podcast clips and creator exports", "Pricing pages clearly state no watermark in listed packs"],
    switchingSteps: ["Create or export the source clip", "Bring it into Huygen Caps", "Generate subtitles", "Check every caption for accuracy", "Apply animated caption styling", "Export the final video"],
    faqItems: [
      { question: "Is Huygen Caps affiliated with Canva?", answer: "No. Huygen Caps is independent and is not affiliated with, endorsed by, or sponsored by Canva." },
      { question: "Why compare Huygen Caps with Canva captions?", answer: "Some creators search for caption tools inside design platforms, while others need a dedicated auto subtitle generator." },
      { question: "Can I still use Canva with Huygen Caps?", answer: "Yes. You can use separate tools in a broader workflow if that fits your production process." },
    ],
    disclaimer: disclaimer("Canva"),
  },
  {
    name: "Adobe Express Captions",
    slug: "adobe-express-captions",
    officialWebsite: "https://www.adobe.com/express/",
    pageTitle: "Adobe Express Captions Alternative | Huygen Caps",
    metaDescription:
      "Compare Huygen Caps with Adobe Express caption workflows for auto subtitles, animated captions and short-form exports.",
    h1: "Adobe Express Captions Alternative for Auto Subtitles & Animated Captions",
    intro:
      "Adobe Express is part of a large creative ecosystem for quick design and video tasks. Huygen Caps is a focused alternative page for users comparing auto subtitle generators, AI caption generators and animated caption workflows for creator videos.",
    bestFor: ["Creators comparing quick creative suites with caption-first tools", "Editors who need animated subtitles for short-form clips", "Agencies preparing captioned Reels, Shorts and TikToks"],
    comparisonAngles: ["Creative ecosystem versus focused subtitle workflow", "Word-level caption editing", "Animated captions and timing review", "Short-form export preparation"],
    limitationsToVerify: ["Adobe Express caption features, plan limits and export details must be verified on Adobe's official website.", "Do not publish direct Adobe feature comparisons without current verification."],
    huygenCapsAdvantages: ["Dedicated to auto subtitles, animated captions and short-form caption exports", "Keeps review-before-publishing language clear for AI-assisted captions", "No watermark across listed Huygen Caps packs"],
    switchingSteps: ["Prepare your final clip", "Upload it to Huygen Caps", "Generate AI-assisted subtitles", "Review the transcript and timing", "Pick animated caption styling", "Export the captioned short-form video"],
    faqItems: [
      { question: "Is Huygen Caps affiliated with Adobe Express?", answer: "No. Huygen Caps is independent and is not affiliated with, endorsed by, or sponsored by Adobe Express or Adobe." },
      { question: "Is this an official Adobe Express captions page?", answer: "No. This is a comparison page for users researching subtitle generator alternatives." },
      { question: "What makes Huygen Caps different?", answer: "Huygen Caps is centered on auto subtitles, word-by-word captions, subtitle timing review and burned-in short-form exports." },
    ],
    disclaimer: disclaimer("Adobe Express"),
  },
];

export const competitorRoutes = competitors.map((competitor) => `/alternatives/${competitor.slug}`);
