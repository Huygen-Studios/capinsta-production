import type { Metadata } from "next";
import { BRAND, FULL_DESCRIPTION, SHORT_DESCRIPTION, PRODUCT_BY_LINE } from "@/site/brand";
import { BasePage } from "@/app/base-page";

export const metadata: Metadata = {
	title: "About",
	description: `Learn about ${BRAND.productName} — a browser-based caption studio by ${BRAND.parentCompany}.`,
	openGraph: {
		title: `About — ${BRAND.productName}`,
		description: `Learn about ${BRAND.productName} and why it was built.`,
	},
};

export default function AboutPage() {
	return (
		<BasePage title="About Capinsta" description={FULL_DESCRIPTION}>
			<div className="prose prose-neutral max-w-none">
				<h2>What is Capinsta?</h2>
				<p>
					Capinsta is a browser-based caption creation tool. You upload a video, generate
					accurate captions with word-level timing, style them with presets that include
					active-word highlighting, and export either a full captioned video or
					captions-only files (SRT and VTT).
				</p>
				<p>
					{SHORT_DESCRIPTION}
				</p>

				<h2>Why was it created?</h2>
				<p>
					Existing captioning tools either require paid subscriptions, lack support for
					mixed-language speech common in Indian content (Hinglish, Telgish), or produce
					captions without the word-level timing needed for animated highlighting. Capinsta
					addresses these gaps with a focus on accuracy, mixed-language support, and styled
					active-word captions — all in the browser with no software to install.
				</p>

				<h2>Privacy-first approach</h2>
				<p>
					Capinsta does not store your videos permanently. Uploaded media and generated
					captions are held only while you are actively editing. After a period of
					inactivity, everything is automatically deleted. This means your content is never
					used for training, resale, or long-term storage.
				</p>

				<h2>{BRAND.parentCompany}</h2>
				<p>
					{PRODUCT_BY_LINE} {BRAND.parentCompany} builds creator-focused tools that
					emphasize accessibility, privacy, and simplicity.
				</p>
				<p>
					Visit <a href={BRAND.companyWebsite}>{BRAND.companyWebsite}</a> to learn more
					about {BRAND.parentCompany}.
				</p>
			</div>
		</BasePage>
	);
}
