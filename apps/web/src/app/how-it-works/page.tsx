import type { Metadata } from "next";
import { BRAND, ROUTES } from "@/site/brand";
import { BasePage } from "@/app/base-page";

export const metadata: Metadata = {
	title: "How It Works",
	description: `Learn how ${BRAND.productName} works: import, generate captions, style, and export.`,
	openGraph: {
		title: `How It Works — ${BRAND.productName}`,
		description: `From upload to export in four steps.`,
	},
};

export default function HowItWorksPage() {
	return (
		<BasePage
			title="How it works"
			description="From raw video to polished, captioned clip in four steps."
		>
			<div className="prose prose-neutral max-w-none">
				<ol>
					<li>
						<h3>Import your video</h3>
						<p>
							Open the editor and drag in a video file. Supported formats include MP4
							and WebM. The video is uploaded temporarily to the server so captions can
							be generated.
						</p>
					</li>
					<li>
						<h3>Generate captions</h3>
						<p>
							Click the generate button. {BRAND.productName} sends the audio to an
							AI speech-recognition service that produces a transcript with word-level
							timing. You can choose English, Hinglish, Telgish, or auto-detect mode for
							mixed Indian-language content.
						</p>
					</li>
					<li>
						<h3>Style and edit</h3>
						<p>
							Choose a caption preset or customize the style manually. Adjust timing on
							the timeline, edit caption text, and preview the result in real time.
							Active-word highlighting shows exactly which word is spoken at each moment.
						</p>
					</li>
					<li>
						<h3>Export</h3>
						<p>
							Download the full captioned video, or export just the subtitle file as SRT
							or VTT. Remember to download your export before leaving the editor.
						</p>
					</li>
				</ol>

				<h2>What happens after I leave?</h2>
				<p>
					Your project is held temporarily on the server. A heartbeat signal keeps the
					project alive while you are actively editing. After a period of inactivity
					(currently 15 minutes without activity), the project, uploaded video, captions,
					transcripts, and any generated exports are automatically deleted.
				</p>
				<p>
					This means you should always download your exports before closing the browser or
					navigating away from the editor.
				</p>

				<h2>What about browser storage?</h2>
				<p>
					Some project metadata may be stored locally in your browser for convenience.
					This local data does not contain your uploaded video files — only references and
					preferences. You can clear this data at any time through your browser settings.
				</p>
			</div>
		</BasePage>
	);
}
