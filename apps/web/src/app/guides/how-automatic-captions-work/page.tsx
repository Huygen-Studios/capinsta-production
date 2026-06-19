import type { Metadata } from "next";
import { BRAND } from "@/site/brand";
import { BasePage } from "@/app/base-page";

export const metadata: Metadata = {
	title: "How automatic captions work",
	description: "Learn how AI speech recognition turns video audio into editable captions with word-level timing.",
};

export default function GuidePage() {
	return (
		<BasePage title="How automatic captions work" description="An overview of the technology behind automatic caption generation.">
			<div className="prose prose-neutral max-w-none">
				<h2>From audio to text</h2>
				<p>
					Automatic caption generation starts with your video's audio track. When you
					upload a video to {BRAND.productName} and click generate, the audio is
					extracted and sent to an AI speech-recognition model. This model converts the
					spoken words into text, similar to how a human transcriber would — but much
					faster.
				</p>

				<h2>Word-level timing</h2>
				<p>
					Basic transcription gives you a block of text. What makes {BRAND.productName}{" "}
					captions useful is word-level timing: the model doesn't just produce text — it
					produces a start time and end time for every individual word. This precise
					timing is what powers active-word highlighting, where each word lights up at the
					exact moment it is spoken during video playback.
				</p>
				<p>
					Word-level timing also lets you fine-tune when each caption appears and
					disappears on the timeline. You can drag caption boundaries, adjust individual
					word timing, and preview the result instantly.
				</p>

				<h2>Language detection and mixed-language support</h2>
				<p>
					Standard caption tools often struggle with code-switching — when a speaker
					alternates between languages, as is common in Indian English content.
					{BRAND.productName} offers dedicated language modes:
				</p>
				<ul>
					<li>
						<strong>English</strong> — standard English speech recognition.
					</li>
					<li>
						<strong>Hinglish</strong> — Hindi-English mixed speech, where speakers
						switch between Hindi and English within the same sentence.
					</li>
					<li>
						<strong>Telgish</strong> — Telugu-English mixed speech.
					</li>
					<li>
						<strong>Auto-detect</strong> — automatically identifies the language mix
						and applies the appropriate model.
					</li>
				</ul>

				<h2>From transcript to captions</h2>
				<p>
					After the speech recognition model produces a timed transcript,{" "}
					{BRAND.productName} groups the words into caption segments. Each segment
					corresponds to a line of text displayed on screen. You can edit these segments,
					adjust their timing, change the text, and apply styling presets before exporting.
				</p>

				<h2>Accuracy and review</h2>
				<p>
					While automatic caption generation is highly accurate, it is not perfect. Proper
					nouns, technical terms, and mumbled speech may produce errors.{" "}
					{BRAND.productName} provides a full editor so you can review and correct any
					mistakes before exporting. We always recommend reviewing captions before
					publishing.
				</p>
			</div>
		</BasePage>
	);
}
