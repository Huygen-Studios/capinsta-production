import type { Metadata } from "next";
import { BRAND } from "@/site/brand";
import { BasePage } from "@/app/base-page";

export const metadata: Metadata = {
	title: "Captions for short-form videos",
	description: "Best practices for captioning reels, shorts, and TikTok-style content with active-word highlighting.",
};

export default function GuidePage() {
	return (
		<BasePage title="Captions for short-form videos" description="Optimize captions for reels, shorts, and vertical video.">
			<div className="prose prose-neutral max-w-none">
				<h2>Why captions matter for short-form content</h2>
				<p>
					Short-form videos — Instagram Reels, YouTube Shorts, TikTok clips — are often
					watched without sound. Captions ensure your message reaches viewers who are
					scrolling in public, in meetings, or simply prefer to read. Studies consistently
					show that captioned short-form videos receive higher engagement and watch time.
				</p>

				<h2>Keep captions short</h2>
				<p>
					For vertical short-form video, aim for one to two lines of text per caption
					segment. Long blocks of text obscure the video and are harder to read on
					small screens. {BRAND.productName} lets you split and resize caption segments
					on the timeline to keep them concise.
				</p>

				<h2>Use active-word highlighting</h2>
				<p>
					Active-word highlighting is especially effective in short-form content. Each
					spoken word lights up as it is spoken, creating a karaoke-style effect that
					draws the viewer's eye and reinforces comprehension. This style is popular on
					TikTok and Instagram Reels for a reason — it works.
				</p>
				<p>
					{BRAND.productName} applies word-level timing automatically, so highlighting
					is accurate without manual adjustment for every word.
				</p>

				<h2>Choose a bold caption style</h2>
				<p>
					On mobile screens, captions need strong contrast and generous sizing. Choose a
					preset with a solid background or thick text outline. Avoid thin fonts or
					low-contrast colors that become unreadable at small sizes.
				</p>

				<h2>Positioning for vertical video</h2>
				<p>
					Short-form vertical videos have a narrow viewing area. Place captions in the
					lower-center portion of the frame, where they are least likely to overlap with
					platform UI elements (user handles, like buttons, captions). Adjust the
					caption position in {BRAND.productName}'s style settings.
				</p>

				<h2>Workflow tips</h2>
				<ul>
					<li>Keep clips short — captioned segments are easier to manage in videos under 60 seconds.</li>
					<li>Generate captions first, then trim the video to match the caption timing.</li>
					<li>Export the full video with burned-in captions for platforms that don't support sidecar subtitles.</li>
					<li>Always review the final export on a phone screen before publishing.</li>
				</ul>
			</div>
		</BasePage>
	);
}
