import type { Metadata } from "next";
import { BRAND } from "@/site/brand";
import { BasePage } from "@/app/base-page";

export const metadata: Metadata = {
	title: "Features",
	description: `Explore ${BRAND.productName} features: automatic captions, active-word highlighting, mixed-language support, styled presets, and export.`,
	openGraph: {
		title: `Features — ${BRAND.productName}`,
		description: `Everything ${BRAND.productName} can do for your caption workflow.`,
	},
};

const featureGroups = [
	{
		heading: "Caption generation",
		items: [
			"Automatic AI-powered caption generation from video audio",
			"Word-level timing for each caption segment",
			"Support for English, Hinglish, Telgish, and auto-detect mixed Indian-language mode",
			"Transcript-based editing before converting to timed captions",
		],
	},
	{
		heading: "Active-word highlighting",
		items: [
			"Each spoken word highlights at the correct moment during playback",
			"Visual emphasis on the active word draws viewer attention",
			"Works with full video export and captions-only export",
		],
	},
	{
		heading: "Caption styling",
		items: [
			"Ready-made caption style presets",
			"Customizable font, size, color, background, and positioning",
			"Bold active-word effects with distinct styling for spoken vs. unspoken words",
		],
	},
	{
		heading: "Editing",
		items: [
			"Browser-based timeline editor with real-time preview",
			"Adjust caption timing by dragging on the timeline",
			"Edit caption text directly in the editor",
			"Split, merge, and re-order caption segments",
		],
	},
	{
		heading: "Export",
		items: [
			"Full video export with captions burned in (MP4)",
			"Captions-only export as SRT or VTT subtitle files",
			"Exported subtitle files work in any editor that supports sidecar subtitles",
			"No watermarks on exports",
		],
	},
	{
		heading: "Privacy and storage",
		items: [
			"No account required to use the editor",
			"Uploaded videos are processed and held only during the editing session",
			"Automatic deletion after a period of inactivity",
			"Your media is never used for training or resale",
		],
	},
];

export default function FeaturesPage() {
	return (
		<BasePage
			title="Features"
			description={`${BRAND.productName} handles the full caption workflow — from upload to export — in one browser tab.`}
		>
			<div className="prose prose-neutral max-w-none">
				{featureGroups.map((group) => (
					<div key={group.heading}>
						<h2>{group.heading}</h2>
						<ul>
							{group.items.map((item) => (
								<li key={item}>{item}</li>
							))}
						</ul>
					</div>
				))}
			</div>
		</BasePage>
	);
}
