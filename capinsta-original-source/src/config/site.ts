import type { Metadata } from "next";

export const siteConfig = {
  siteName: "Huygen Caps",
  companyName: "Huygen Studios",
  domain: process.env.PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://huygencaps.com",
  defaultTitle: "Huygen Caps - Auto Subtitle Generator & AI Caption Maker",
  defaultDescription:
    "Generate accurate subtitles, create animated word-by-word captions, edit timing, and export ready-to-post videos for Reels, Shorts and TikToks.",
  defaultKeywords: [
    "AI caption generator",
    "auto subtitle generator",
    "animated captions",
    "word by word captions",
    "captions for reels",
    "YouTube Shorts captions",
    "TikTok caption generator",
    "Instagram Reels caption generator",
    "subtitle timing editor",
    "burn captions into video",
    "Telugu caption generator",
    "Hinglish caption generator",
  ],
  ogImage: "/og/huygen-caps-og.png",
  contactEmail: "hello@huygenstudios.com",
  appPath: "/editor",
};

export const publicRoutes = [
  "/",
  "/pricing",
  "/about",
  "/contact",
  "/ai-caption-generator",
  "/auto-subtitle-generator",
  "/animated-captions",
  "/word-by-word-captions",
  "/captions-for-reels",
  "/youtube-shorts-caption-generator",
  "/tiktok-caption-generator",
  "/telugu-caption-generator",
  "/hinglish-caption-generator",
  "/subtitle-timing-editor",
  "/alternatives",
  "/alternatives/veed",
  "/alternatives/kapwing",
  "/alternatives/happyscribe",
  "/alternatives/clideo",
  "/alternatives/clipchamp",
  "/alternatives/canva-captions",
  "/alternatives/adobe-express-captions",
  "/privacy-policy",
  "/terms-of-service",
  "/refund-policy",
  "/cookie-policy",
  "/disclaimer",
  "/data-deletion",
];

export function absoluteUrl(path = "/") {
  const normalizedDomain = siteConfig.domain.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedDomain}${normalizedPath}`;
}

export function createMetadata({
  title,
  description,
  path = "/",
  keywords = [],
  noIndex = false,
}: {
  title: string;
  description: string;
  path?: string;
  keywords?: string[];
  noIndex?: boolean;
}): Metadata {
  const image = absoluteUrl(siteConfig.ogImage);

  return {
    title,
    description,
    keywords: [...siteConfig.defaultKeywords, ...keywords],
    alternates: {
      canonical: absoluteUrl(path),
    },
    openGraph: {
      title,
      description,
      url: absoluteUrl(path),
      siteName: siteConfig.siteName,
      images: [{ url: image, width: 1200, height: 630, alt: `${siteConfig.siteName} social preview` }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
    robots: noIndex
      ? {
          index: false,
          follow: false,
        }
      : {
          index: true,
          follow: true,
        },
  };
}

export const homeFaqs = [
  {
    question: "What is Huygen Caps?",
    answer:
      "Huygen Caps is an auto subtitle generator and AI-assisted caption editor for short-form videos. It helps creators generate subtitles, adjust timing, style animated captions and export videos for social platforms.",
  },
  {
    question: "Can I edit the captions after they are generated?",
    answer:
      "Yes. Captions should always be reviewed before publishing, and Huygen Caps is built around editable timing, text and styling controls.",
  },
  {
    question: "Does Huygen Caps make word-by-word captions?",
    answer:
      "Huygen Caps supports word-level caption workflows so creators can build fast, readable captions for talking-head clips, podcast clips and short-form edits.",
  },
  {
    question: "Can I export burned-in captions?",
    answer:
      "Yes. The product is designed for export-ready videos with captions rendered directly into the final video.",
  },
  {
    question: "Is it only for TikTok?",
    answer:
      "No. Huygen Caps is useful for TikToks, Instagram Reels, YouTube Shorts, podcast clips, agency client videos and other short-form formats.",
  },
  {
    question: "Are AI captions always accurate?",
    answer:
      "No transcription system is perfect. Huygen Caps is AI-assisted, so you should review and correct captions before publishing.",
  },
  {
    question: "Does Huygen Caps support Telugu or Hinglish captions?",
    answer:
      "Huygen Caps includes launch pages for Telugu and Hinglish creator workflows. Actual language availability should be verified against the product configuration before paid launch.",
  },
];

export const pricingPlans = [
  {
    name: "Starter",
    price: "Rs. 500/mo",
    description: "For creators making a small batch of captioned short-form videos each month.",
    cta: "Choose Starter",
    features: ["10 captioned videos per month", "No watermark", "Auto subtitle generation", "Animated caption styles", "Burned-in video export"],
  },
  {
    name: "Creator",
    price: "Rs. 1000/mo",
    description: "For regular creators and editors producing more Reels, Shorts and TikToks.",
    cta: "Choose Creator",
    features: ["30 captioned videos per month", "No watermark", "Word-by-word captions", "Subtitle timing editor", "Reels, Shorts and TikTok workflows"],
  },
  {
    name: "Custom",
    price: "Custom",
    description: "For agencies, teams and high-volume caption workflows that need flexible limits.",
    cta: "Contact Sales",
    features: ["Custom monthly video limit", "No watermark", "Team and agency workflow planning", "Custom support terms", "Billing terms to confirm before launch"],
  },
];

export const legalUpdatedDate = "June 7, 2026";

export const keywordPages = [
  {
    slug: "ai-caption-generator",
    keyword: "AI caption generator",
    title: "AI Caption Generator - Create Animated Captions Online | Huygen Caps",
    description:
      "Create editable AI captions for Reels, Shorts and TikToks with word-level timing, animated styles and export-ready video workflows.",
    h1: "AI Caption Generator for Short-Form Videos",
    intro:
      "Huygen Caps helps creators turn spoken video into editable captions that are ready for social publishing. Generate captions, review timing, apply animated styles and export a finished clip from one focused workspace.",
    audience: "Built for creators, editors, agencies, YouTubers, TikTok teams and podcast clip editors who need fast captions without giving up control.",
    workflow: ["Upload a video", "Generate AI-assisted captions", "Review words and timing", "Style captions for the platform", "Export a ready-to-post video"],
    features: ["Editable AI captions", "Word-level timing controls", "Animated caption presets", "Burned-in caption export", "Vertical video workflow", "Internal review before publishing"],
    related: ["/auto-subtitle-generator", "/animated-captions", "/word-by-word-captions"],
    faqs: [
      ["Is Huygen Caps an AI caption generator?", "Yes. It uses AI-assisted transcription and editing tools to help create captions for short videos."],
      ["Can I change the generated captions?", "Yes. You can review and edit caption text, timing and styles before export."],
      ["Does it guarantee perfect captions?", "No. AI captions can contain errors, so creators should review every video before publishing."],
    ],
  },
  {
    slug: "auto-subtitle-generator",
    keyword: "auto subtitle generator",
    title: "Auto Subtitle Generator - Generate Editable Subtitles | Huygen Caps",
    description:
      "Generate editable subtitles for short videos, fix timing, style captions and export burned-in subtitle videos with Huygen Caps.",
    h1: "Auto Subtitle Generator for Editable Video Captions",
    intro:
      "Use Huygen Caps to create automatic subtitles, then refine them in an editor made for short-form social videos. The workflow keeps subtitles editable so you can correct wording, timing and style before export.",
    audience: "For video editors, creators, social teams and podcasters who need subtitles that move from draft to publish-ready quickly.",
    workflow: ["Import your clip", "Generate subtitles", "Adjust timing", "Choose caption style", "Export with subtitles burned in"],
    features: ["AI-assisted subtitle drafts", "Editable timing", "Readable social caption layouts", "Export-ready burned-in subtitles", "Support for creator review workflows"],
    related: ["/ai-caption-generator", "/subtitle-timing-editor", "/word-by-word-captions"],
    faqs: [
      ["What is an auto subtitle generator?", "It creates subtitle text and timing from a video's spoken audio so you can edit and export captions faster."],
      ["Can I use it for Reels and Shorts?", "Yes. Huygen Caps is positioned around short-form formats including Reels, Shorts and TikToks."],
      ["Should I review automatic subtitles?", "Yes. Always review AI-assisted subtitles for accuracy and context."],
    ],
  },
  {
    slug: "animated-captions",
    keyword: "animated captions",
    title: "Animated Captions Generator for Short Videos | Huygen Caps",
    description:
      "Create animated captions for talking-head clips, Reels, Shorts and TikToks with editable timing and social-ready caption styles.",
    h1: "Animated Captions for Reels, Shorts and TikToks",
    intro:
      "Animated captions help viewers follow your video even when they watch without sound. Huygen Caps gives creators caption presets and timing controls for punchy, readable short-form edits.",
    audience: "For creators and editors making talking-head videos, podcast clips, tutorials, explainers and agency deliverables.",
    workflow: ["Generate captions", "Pick an animated style", "Tune readability", "Check timing", "Export your captioned clip"],
    features: ["Caption animation presets", "Word highlight styles", "Readable vertical layouts", "Timing editor", "Burned-in exports", "Creator-friendly style controls"],
    related: ["/ai-caption-generator", "/word-by-word-captions", "/captions-for-reels"],
    faqs: [
      ["Why use animated captions?", "They can improve readability and help important words stand out in fast short-form clips."],
      ["Can I edit the style?", "Yes. Huygen Caps includes caption styling controls so you can adjust the look before exporting."],
      ["Are animations suitable for every video?", "Not always. Keep captions readable and choose motion that supports the content."],
    ],
  },
  {
    slug: "word-by-word-captions",
    keyword: "word-by-word captions",
    title: "Word-by-Word Caption Generator | Huygen Caps",
    description:
      "Create word-by-word captions with editable timing for social videos, podcast clips, Reels, Shorts and TikToks.",
    h1: "Word-by-Word Caption Generator",
    intro:
      "Word-by-word captions give short videos a more dynamic reading rhythm. Huygen Caps helps you generate caption timing, review each phrase and export styled captions for social platforms.",
    audience: "For editors and creators who want captions that follow speech closely without manually building every word from scratch.",
    workflow: ["Upload video", "Generate word timing", "Review caption chunks", "Apply a word highlight style", "Export final video"],
    features: ["Word-level timing", "Highlight caption styles", "Editable text", "Short-form export workflow", "Timing review tools", "Burned-in caption rendering"],
    related: ["/ai-caption-generator", "/animated-captions", "/subtitle-timing-editor"],
    faqs: [
      ["What are word-by-word captions?", "They are captions where individual words or short phrases can be highlighted in sync with speech."],
      ["Can I fix timing mistakes?", "Yes. The subtitle timing editor exists so captions can be corrected before export."],
      ["Are word-by-word captions good for podcasts?", "They are often useful for podcast clips and talking-head videos when readability stays clear."],
    ],
  },
  {
    slug: "captions-for-reels",
    keyword: "captions for Reels",
    title: "Instagram Reels Caption Generator | Huygen Caps",
    description:
      "Generate captions for Instagram Reels with editable subtitle timing, animated styles and vertical video export workflows.",
    h1: "Instagram Reels Caption Generator",
    intro:
      "Huygen Caps helps Reels creators add clear, styled captions to vertical videos. Generate a caption draft, edit the timing and export a video that is ready for review and posting.",
    audience: "For Instagram creators, social media managers, agencies and editors producing Reels at a regular pace.",
    workflow: ["Upload a Reel", "Generate captions", "Make text corrections", "Choose a Reels-friendly style", "Export for publishing"],
    features: ["Vertical caption layouts", "Editable subtitle timing", "Animated caption presets", "Burned-in exports", "Creator review workflow", "Social-first formatting"],
    related: ["/ai-caption-generator", "/youtube-shorts-caption-generator", "/tiktok-caption-generator"],
    faqs: [
      ["Can I use Huygen Caps for Instagram Reels?", "Yes. The product is built around short-form creator workflows including Reels."],
      ["Does it post directly to Instagram?", "This launch copy does not assume direct posting. Export the captioned video, then publish through your normal workflow."],
      ["Can agencies use it for client Reels?", "Yes, the workflow is relevant for agency caption and editing work."],
    ],
  },
  {
    slug: "youtube-shorts-caption-generator",
    keyword: "YouTube Shorts caption generator",
    title: "YouTube Shorts Caption Generator | Huygen Caps",
    description:
      "Create captions for YouTube Shorts with AI-assisted subtitle generation, editable timing and export-ready caption styles.",
    h1: "YouTube Shorts Caption Generator",
    intro:
      "Shorts move quickly, so captions need to be readable and timed well. Huygen Caps gives creators a focused way to generate, edit and style captions for YouTube Shorts.",
    audience: "For YouTubers, clip editors, podcast teams and agencies repurposing long-form content into Shorts.",
    workflow: ["Import your Short", "Generate caption text", "Review timing", "Style the captions", "Export the captioned video"],
    features: ["Shorts-friendly captions", "AI-assisted transcription", "Timing corrections", "Animated styles", "Burned-in captions", "Podcast clip support"],
    related: ["/ai-caption-generator", "/captions-for-reels", "/tiktok-caption-generator"],
    faqs: [
      ["Can Huygen Caps caption YouTube Shorts?", "Yes. It is positioned for short-form videos including YouTube Shorts."],
      ["Can I repurpose podcast clips?", "Yes. Podcast and talking-head clips are core use cases."],
      ["Does it replace YouTube captions?", "It creates burned-in captions for videos; platform caption settings are separate."],
    ],
  },
  {
    slug: "tiktok-caption-generator",
    keyword: "TikTok caption generator",
    title: "TikTok Caption Generator | Huygen Caps",
    description:
      "Generate TikTok captions with editable timing, animated word highlights and export-ready burned-in subtitles.",
    h1: "TikTok Caption Generator",
    intro:
      "Huygen Caps helps TikTok creators make captions that are easier to read, edit and export. Generate a draft, tune the timing and apply a style that fits your clip.",
    audience: "For TikTok creators, short-form editors, social teams and agencies producing fast captioned videos.",
    workflow: ["Upload TikTok clip", "Generate AI captions", "Correct text", "Adjust style and timing", "Export a final video"],
    features: ["TikTok-ready vertical workflow", "Word highlight options", "Editable subtitles", "Caption animation presets", "Burned-in export", "Review before publishing"],
    related: ["/ai-caption-generator", "/captions-for-reels", "/youtube-shorts-caption-generator"],
    faqs: [
      ["Can I make TikTok captions with Huygen Caps?", "Yes. TikTok caption workflows are one of the product's intended use cases."],
      ["Are captions burned into the video?", "Huygen Caps is designed for burned-in caption export workflows."],
      ["Should captions be checked manually?", "Yes. AI-assisted captions should be reviewed before publishing."],
    ],
  },
  {
    slug: "telugu-caption-generator",
    keyword: "Telugu caption generator",
    title: "Telugu Caption Generator for Reels & Shorts | Huygen Caps",
    description:
      "Create Telugu caption workflows for Reels and Shorts with editable AI-assisted captions, timing review and export-ready styles.",
    h1: "Telugu Caption Generator for Reels and Shorts",
    intro:
      "Huygen Caps includes launch positioning for Telugu creator workflows, helping teams plan captions, timing review and styled exports for short-form videos.",
    audience: "For Telugu creators, regional social teams and editors who need caption workflows for vertical video.",
    workflow: ["Upload a Telugu video", "Generate a caption draft", "Review language accuracy", "Adjust timing and style", "Export after review"],
    features: ["Regional creator workflow", "Editable caption text", "Timing review", "Short-form formats", "Burned-in exports", "Manual review emphasis"],
    related: ["/ai-caption-generator", "/hinglish-caption-generator", "/auto-subtitle-generator"],
    faqs: [
      ["Does Huygen Caps support Telugu?", "This page is prepared for Telugu caption workflows. Verify production language support before paid launch."],
      ["Should Telugu captions be reviewed?", "Yes. Regional language captions should be reviewed carefully before publishing."],
      ["Can I use it for Reels and Shorts?", "The workflow is designed for short-form formats such as Reels and Shorts."],
    ],
  },
  {
    slug: "hinglish-caption-generator",
    keyword: "Hinglish caption generator",
    title: "Hinglish Caption Generator for Reels & Shorts | Huygen Caps",
    description:
      "Create Hinglish captions for Reels and Shorts with editable caption text, timing controls and export-ready video styles.",
    h1: "Hinglish Caption Generator for Reels and Shorts",
    intro:
      "Hinglish videos often need captions that preserve natural speech. Huygen Caps is positioned to support creator workflows where captions can be generated, reviewed and corrected before export.",
    audience: "For Indian creators, agencies, social teams and editors working with mixed Hindi-English short-form videos.",
    workflow: ["Upload a Hinglish clip", "Generate captions", "Review spellings and context", "Fix timing", "Export the final clip"],
    features: ["Mixed-language workflow", "Editable text", "Timing controls", "Animated caption styles", "Vertical video exports", "Review-first publishing"],
    related: ["/ai-caption-generator", "/telugu-caption-generator", "/word-by-word-captions"],
    faqs: [
      ["What is a Hinglish caption generator?", "It helps create captions for videos that mix Hindi and English speech."],
      ["Can AI misunderstand Hinglish?", "Yes. Mixed-language captions should be reviewed carefully before posting."],
      ["Is this for short videos?", "Yes. Huygen Caps focuses on Reels, Shorts, TikToks and creator clips."],
    ],
  },
  {
    slug: "subtitle-timing-editor",
    keyword: "subtitle timing editor",
    title: "Subtitle Timing Editor for AI Captions | Huygen Caps",
    description:
      "Fix subtitle timing for AI captions, adjust word-level captions and export short-form videos with burned-in subtitles.",
    h1: "Subtitle Timing Editor for AI Captions",
    intro:
      "Good captions depend on timing. Huygen Caps gives creators and editors a place to review caption timing, refine text and prepare export-ready subtitles.",
    audience: "For editors who need control after automatic caption generation, especially for talking-head clips and social videos.",
    workflow: ["Generate captions", "Inspect timing", "Adjust caption placement", "Review playback", "Export with corrected subtitles"],
    features: ["Timing review workflow", "Word-level caption support", "Editable captions", "Playback-based checking", "Burned-in export", "Short-form video focus"],
    related: ["/auto-subtitle-generator", "/word-by-word-captions", "/ai-caption-generator"],
    faqs: [
      ["Why edit subtitle timing?", "Automatic timing can drift or feel awkward. Reviewing timing improves readability and publishing quality."],
      ["Can I edit AI captions?", "Yes. The timing editor is intended for post-generation corrections."],
      ["Does timing affect exports?", "Yes. The reviewed timing is used when rendering captions into the exported video."],
    ],
  },
];
