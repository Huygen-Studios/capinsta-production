import type { Metadata } from "next";
import { BRAND } from "@/site/brand";
import { BasePage } from "@/app/base-page";
import { FaqStructuredData } from "@/components/structured-data";

export const metadata: Metadata = {
	title: "FAQ",
	description: `Frequently asked questions about ${BRAND.productName}: pricing, languages, exports, privacy, and more.`,
	openGraph: {
		title: `FAQ — ${BRAND.productName}`,
		description: `Answers to common questions about ${BRAND.productName}.`,
	},
};

const faqs = [
	{
		q: "Is Capinsta free?",
		a: "Yes. Capinsta is free to use. You can upload videos, generate captions, style them, and export without paying.",
	},
	{
		q: "Do I need to create an account?",
		a: "No. Capinsta does not require an account, login, or sign-up. Just open the editor and start.",
	},
	{
		q: "What video formats are supported for upload?",
		a: "Common formats including MP4 and WebM. The editor accepts most video files that play in modern browsers.",
	},
	{
		q: "What languages are supported for caption generation?",
		a: "English, Hinglish (Hindi-English mixed), Telgish (Telugu-English mixed), and an auto-detect mode for mixed Indian-language content.",
	},
	{
		q: "Can I edit the generated captions?",
		a: "Yes. You can edit caption text, adjust timing by dragging on the timeline, split and merge segments, and preview changes in real time.",
	},
	{
		q: "What export formats are available?",
		a: "You can export a full captioned video (MP4) with subtitles burned in, or export just the captions as SRT or VTT subtitle files that work with any video editor.",
	},
	{
		q: "What is active-word highlighting?",
		a: "Active-word highlighting displays each spoken word with emphasis (bold, color change, or background) at the exact moment it is spoken during playback. This makes captions more engaging and accessible.",
	},
	{
		q: "Is my uploaded video stored permanently?",
		a: "No. Your video, captions, and generated exports are held only during your active editing session. They are automatically deleted after a period of inactivity.",
	},
	{
		q: "What happens to my project if I close the browser?",
		a: "A heartbeat signal keeps your project alive while you are editing. If you close the browser and do not return, the project and all associated files (video, captions, exports) are automatically deleted after the inactivity timeout.",
	},
	{
		q: "Should I download my export before leaving?",
		a: "Yes. Always download your exports before closing the editor or navigating away. Once a project expires, files cannot be recovered.",
	},
	{
		q: "Are there watermarks on exports?",
		a: "No. Capinsta does not add watermarks to exported videos or subtitle files.",
	},
	{
		q: "Is there a file size or duration limit?",
		a: "Because Capinsta is a free, browser-based service, very large or very long videos may take longer to process or may not be supported. We recommend clips under a few minutes for the best experience.",
	},
	{
		q: "Can I use Capinsta captions in other video editors?",
		a: "Yes. Export captions as SRT or VTT and import them into editors like Premiere Pro, DaVinci Resolve, CapCut, or any tool that supports sidecar subtitles.",
	},
	{
		q: "Who operates Capinsta?",
		a: `${BRAND.productName} is a product by ${BRAND.parentCompany}. For inquiries, contact ${BRAND.supportEmail}.`,
	},
];

export default function FaqPage() {
	return (
		<>
			<FaqStructuredData
				questions={faqs.map((item) => ({ question: item.q, answer: item.a }))}
			/>
			<BasePage
				title="Frequently asked questions"
				description="Common questions about Capinsta, answered."
			>
				<div className="max-w-3xl">
					<dl className="space-y-6">
						{faqs.map((item) => (
							<div
								key={item.q}
								className="rounded-2xl border-2 border-ink bg-background p-6"
							>
								<dt className="text-base font-semibold">{item.q}</dt>
								<dd className="mt-2 text-muted-foreground text-sm leading-relaxed">
									{item.a}
								</dd>
							</div>
						))}
					</dl>
				</div>
			</BasePage>
		</>
	);
}
