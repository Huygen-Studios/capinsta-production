import type { Metadata } from "next";
import { BRAND } from "@/site/brand";
import { BasePage } from "@/app/base-page";

export const metadata: Metadata = {
	title: "Why captions improve accessibility and viewer comprehension",
	description: "The measurable impact of captions on engagement, accessibility compliance, and audience reach.",
};

export default function GuidePage() {
	return (
		<BasePage title="Why captions improve accessibility and comprehension" description="The measurable impact of captions.">
			<div className="prose prose-neutral max-w-none">
				<h2>Accessibility</h2>
				<p>
					Captions make video content accessible to the hundreds of millions of people
					worldwide who are deaf or hard of hearing. Without captions, video content is
					simply inaccessible to this audience. Captions transform audio-only information
					into a format that everyone can consume.
				</p>
				<p>
					In many jurisdictions, providing captions for public video content is not just
					good practice — it is a legal accessibility requirement. Adding captions helps
					ensure your content meets accessibility standards.
				</p>

				<h2>Viewer comprehension</h2>
				<p>
					Captions benefit far more viewers than just those with hearing differences.
					Research consistently shows that captions improve comprehension and retention
					for:
				</p>
				<ul>
					<li>Non-native speakers of the video's language.</li>
					<li>Viewers in noisy environments or with sound off.</li>
					<li>People watching content with technical or specialized vocabulary.</li>
					<li>Anyone who processes text more effectively than speech.</li>
				</ul>

				<h2>Engagement and watch time</h2>
				<p>
					Multiple studies have found that captioned videos have higher engagement and
					longer watch times than uncaptioned videos. On social platforms where many
					users watch with sound off by default, captions can be the difference between
					a viewer staying or scrolling past. This is especially true for short-form
					vertical content.
				</p>

				<h2>SEO and discoverability</h2>
				<p>
					Search engines and platforms cannot &quot;listen&quot; to video audio. Captions
					provide text that search engines can index, making your content more
					discoverable. Exporting captions as SRT or VTT and including them with your
					video upload helps platforms understand and surface your content.
				</p>

				<h2>How {BRAND.productName} helps</h2>
				<p>
					{BRAND.productName} makes adding captions fast and free. Generate accurate
					captions automatically, edit them to perfection, apply engaging active-word
					highlighting, and export either a full captioned video or a standalone
					subtitle file. No subscription or software installation required.
				</p>
			</div>
		</BasePage>
	);
}
