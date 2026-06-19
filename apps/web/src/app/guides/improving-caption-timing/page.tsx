import type { Metadata } from "next";
import { BRAND } from "@/site/brand";
import { BasePage } from "@/app/base-page";

export const metadata: Metadata = {
	title: "How to improve caption timing",
	description: "Tips for adjusting word-level timing and getting frame-accurate captions in Capinsta.",
};

export default function GuidePage() {
	return (
		<BasePage title="How to improve caption timing" description="Adjust word-level timing for perfect sync.">
			<div className="prose prose-neutral max-w-none">
				<h2>Why timing matters</h2>
				<p>
					Caption timing determines when each line of text appears on screen and when it
					disappears. Poor timing — captions that appear too early, too late, or linger
					too long — is distracting and can make content harder to follow. Good timing
					makes captions feel natural and effortless.
				</p>

				<h2>Using the timeline editor</h2>
				<p>
					{BRAND.productName} provides a visual timeline where each caption segment is
					represented as a block. You can:
				</p>
				<ul>
					<li><strong>Drag edges</strong> to adjust when a caption starts or ends.</li>
					<li><strong>Split a segment</strong> to break one caption into two at a specific point.</li>
					<li><strong>Merge segments</strong> to combine adjacent captions into one.</li>
					<li><strong>Edit text directly</strong> by clicking on a caption segment.</li>
				</ul>

				<h2>Frame-accurate adjustments</h2>
				<p>
					Zoom in on the timeline to see individual frames. This is especially useful for
					music videos or fast-paced content where words change rapidly. At maximum zoom,
					you can align caption transitions to the exact frame where a word is spoken.
				</p>

				<h2>Handling pauses and silence</h2>
				<p>
					Natural speech includes pauses. The automatic generator may produce captions that
					span these pauses, making the text appear to hang on screen. Use the split tool
					to break captions at natural pause points, or drag the end of a caption
					segment to cut it shorter.
				</p>

				<h2>Preview frequently</h2>
				<p>
					The real-time preview is your best tool for checking timing. Play through the
					video and watch how captions appear and disappear. If anything feels off — too
					fast, too slow, or out of sync — pause, adjust, and preview again.
				</p>

				<h2>Word-level timing for active-word highlighting</h2>
				<p>
					Active-word highlighting depends on accurate per-word timing. If the highlight
					appears to lag or jump, zoom into the timeline and adjust the word boundaries.
					Small adjustments of a few frames can make a significant difference in how
					natural the highlighting feels.
				</p>
			</div>
		</BasePage>
	);
}
