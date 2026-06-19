import type { Metadata } from "next";
import { BRAND } from "@/site/brand";
import { BasePage } from "@/app/base-page";
import Link from "next/link";

export const metadata: Metadata = {
	title: "Guides",
	description: `Caption creation guides from ${BRAND.productName}: how automatic captions work, SRT vs VTT, language workflows, and more.`,
	openGraph: {
		title: `Guides — ${BRAND.productName}`,
		description: `Learn how to create better captions with ${BRAND.productName}.`,
	},
};

type Guide = { slug: string; title: string; description: string };

const guides: Guide[] = [
	{
		slug: "how-automatic-captions-work",
		title: "How automatic captions work",
		description:
			"An overview of AI speech recognition, word-level timing, and how Capinsta turns your video's audio into editable captions.",
	},
	{
		slug: "improving-caption-timing",
		title: "How to improve caption timing",
		description:
			"Tips for adjusting word-level timing, fixing sync issues, and getting frame-accurate captions.",
	},
	{
		slug: "srt-versus-vtt",
		title: "SRT versus VTT: which subtitle format to use",
		description:
			"A comparison of the two most common subtitle formats, when to use each, and how to export them from Capinsta.",
	},
	{
		slug: "captions-for-short-form-video",
		title: "Captions for short-form videos",
		description:
			"Best practices for captioning reels, shorts, and TikTok-style content with active-word highlighting.",
	},
	{
		slug: "hinglish-telgish-caption-workflows",
		title: "English, Hinglish, and Telgish caption workflows",
		description:
			"How Capinsta handles mixed-language speech common in Indian content, and how to choose the right language mode.",
	},
	{
		slug: "why-captions-improve-accessibility",
		title: "Why captions improve accessibility and viewer comprehension",
		description:
			"The measurable impact of captions on engagement, accessibility compliance, and audience reach.",
	},
];

export default function GuidesPage() {
	return (
		<BasePage
			title="Guides"
			description="Learn how to create better captions with Capinsta."
		>
			<div className="max-w-3xl space-y-4">
				{guides.map((guide) => (
					<Link
						key={guide.slug}
						href={`/guides/${guide.slug}`}
						className="block rounded-2xl border-2 border-ink bg-background p-6 transition-transform hover:-translate-y-0.5 hover:shadow-brut"
					>
						<h2 className="text-lg font-semibold">{guide.title}</h2>
						<p className="mt-1 text-muted-foreground text-sm leading-relaxed">
							{guide.description}
						</p>
					</Link>
				))}
			</div>
		</BasePage>
	);
}
