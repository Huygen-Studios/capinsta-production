import type { Metadata } from "next";
import { BRAND } from "@/site/brand";
import { BasePage } from "@/app/base-page";

export const metadata: Metadata = {
	title: "SRT versus VTT: which subtitle format to use",
	description: "Compare SRT and VTT subtitle formats and learn when to use each with Capinsta.",
};

export default function GuidePage() {
	return (
		<BasePage title="SRT versus VTT" description="A comparison of the two most common subtitle formats.">
			<div className="prose prose-neutral max-w-none">
				<h2>What are SRT and VTT?</h2>
				<p>
					Both SRT (SubRip Text) and VTT (Web Video Text Tracks) are plain-text
					formats for storing timed subtitles. Each format stores a sequence of caption
					segments with start times, end times, and the text to display. {BRAND.productName}{" "}
					can export captions in both formats.
				</p>

				<h2>SRT — SubRip Text</h2>
				<p>SRT is the most widely supported subtitle format. Key characteristics:</p>
				<ul>
					<li>Supported by virtually every video player and editor.</li>
					<li>Simple plain-text format with numbered entries.</li>
					<li>Uses comma-separated timing (HH:MM:SS,mmm).</li>
					<li>No native styling support — styling is applied by the player.</li>
					<li>Best for: offline editing, legacy systems, maximum compatibility.</li>
				</ul>

				<h2>VTT — Web Video Text Tracks</h2>
				<p>VTT is the W3C standard for web video captions. Key characteristics:</p>
				<ul>
					<li>Native to HTML5 <code>&lt;track&gt;</code> element.</li>
					<li>Supports optional styling (CSS classes, positioning, voice tags).</li>
					<li>Uses dot-separated timing (HH:MM:SS.mmm).</li>
					<li>Built-in support in browsers, YouTube, and modern platforms.</li>
					<li>Best for: web publishing, platforms that accept VTT uploads.</li>
				</ul>

				<h2>Which should you use?</h2>
				<p>
					If you are importing captions into a traditional video editor (Premiere Pro,
					DaVinci Resolve, etc.), SRT is the safest choice because of near-universal
					support. If you are publishing to a web platform that accepts VTT, use VTT for
					the best results with web-native styling.
				</p>
				<p>
					{BRAND.productName} lets you export both, so you can try each and see which
					works best for your workflow.
				</p>

				<h2>Exporting from Capinsta</h2>
				<p>
					In the export dialog, choose &quot;Captions only&quot; and select either SRT or
					VTT. The file downloads immediately and can be imported into any compatible
					editor or uploaded directly to supported platforms.
				</p>
			</div>
		</BasePage>
	);
}
