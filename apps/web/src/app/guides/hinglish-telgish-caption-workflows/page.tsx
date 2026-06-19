import type { Metadata } from "next";
import { BRAND } from "@/site/brand";
import { BasePage } from "@/app/base-page";

export const metadata: Metadata = {
	title: "English, Hinglish, and Telgish caption workflows",
	description: "How Capinsta handles mixed-language speech common in Indian content, and how to choose the right language mode.",
};

export default function GuidePage() {
	return (
		<BasePage title="English, Hinglish, and Telgish caption workflows" description="Handling mixed-language speech in Indian content.">
			<div className="prose prose-neutral max-w-none">
				<h2>The challenge of code-switching</h2>
				<p>
					Indian English content frequently involves code-switching — the practice of
					alternating between two or more languages within the same conversation or even
					the same sentence. A creator might speak Hindi and English in the same breath
					(Hinglish), or Telugu and English (Telgish). Standard caption tools trained on
					a single language often fail at these transitions, producing garbled or
					incorrect text.
				</p>

				<h2>Capinsta's language modes</h2>
				<p>
					{BRAND.productName} offers dedicated modes to handle this reality:
				</p>
				<ul>
					<li>
						<strong>English</strong> — for content spoken primarily or entirely in
						English. Best for podcasts, tutorials, and presentations in English.
					</li>
					<li>
						<strong>Hinglish</strong> — for content where the speaker alternates
						between Hindi and English. The model recognizes both languages and
						transcribes each word in the appropriate script or romanized form.
					</li>
					<li>
						<strong>Telgish</strong> — for content mixing Telugu and English.
					</li>
					<li>
						<strong>Auto-detect mixed Indian-language mode</strong> — when you are not
						sure which mix applies, or when a single video contains multiple language
						combinations. The model detects the dominant languages and adjusts.
					</li>
				</ul>

				<h2>Choosing the right mode</h2>
				<p>
					If your video is entirely in one language, choose that language directly for
					the best accuracy. If your content mixes languages, pick the Hinglish or
					Telgish mode that matches your primary mix. If you are captioning a video with
					complex or shifting language use, use auto-detect.
				</p>

				<h2>Editing mixed-language captions</h2>
				<p>
					Even with the correct mode, you may want to adjust how mixed-language words
					appear. For example, you might prefer Hindi words romanized rather than in
					Devanagari script. {BRAND.productName}'s editor lets you edit any caption text
					directly. Adjust spelling, change script representations, or rewrite phrasing
					to match your audience's expectations.
				</p>

				<h2>Word-level timing across languages</h2>
				<p>
					One of the advantages of {BRAND.productName}'s word-level timing is that it
					preserves language switching accurately. When a speaker switches from Hindi to
					English mid-sentence, each word is still timed individually. This means
					active-word highlighting stays accurate even during language transitions — the
					highlight follows the speaker regardless of which language is being spoken.
				</p>
			</div>
		</BasePage>
	);
}
