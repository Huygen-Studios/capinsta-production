import type { Metadata } from "next";
import { BRAND, PRODUCT_BY_LINE } from "@/site/brand";
import { BasePage } from "@/app/base-page";

export const metadata: Metadata = {
	title: "Accessibility",
	description: `${BRAND.productName}'s commitment to accessibility, and how to report accessibility problems.`,
};

export default function AccessibilityPage() {
	return (
		<BasePage title="Accessibility" description={`${BRAND.productName}'s commitment to accessibility, and how to report problems.`}>
			<div className="prose prose-neutral max-w-none">
				<p className="text-sm text-muted-foreground">Last updated: June 19, 2026</p>

				<p>
					{BRAND.parentCompany} wants {BRAND.productName} (the &quot;Service&quot;) to be usable by as many people as possible. This page explains our accessibility goals and how to reach us if you run into a problem. {PRODUCT_BY_LINE}
				</p>

				<h2>Our commitment</h2>
				<p>
					We aim to make {BRAND.productName} approachable and usable, including for people who rely on keyboards, screen readers, or other assistive technology. We treat accessibility as an ongoing goal, not a one-time checklist, and we work to improve the experience over time.
				</p>

				<h2>Keyboard and readable interface</h2>
				<p>Our accessibility goals include:</p>
				<ul>
					<li><strong>Keyboard usability.</strong> Making the core editor and navigation usable without a mouse, so that people who navigate by keyboard can complete the main tasks of the Service.</li>
					<li><strong>Readable interface.</strong> Using legible type, sufficient contrast, and clear layout so that content is easy to read and understand.</li>
					<li><strong>Predictable structure.</strong> Keeping headings, controls, and landmarks consistent so assistive technology and users can find their way around.</li>
				</ul>

				<h2>Honest about our current state</h2>
				<p>
					We do not claim that {BRAND.productName} currently meets any specific accessibility standard or holds any accessibility certification. Video captioning involves complex interactive timelines, waveforms, and drag interactions that can be challenging for some assistive technologies. We are working to improve these areas, and we welcome your feedback about what matters most to you.
				</p>

				<h2>What captions are for</h2>
				<p>
					Although {BRAND.productName} creates captions for videos, those captions improve the accessibility of the videos you produce with the Service. They do not, by themselves, make the {BRAND.productName} editing interface accessible, and they do not guarantee that your published video complies with any particular accessibility regulation.
				</p>

				<h2>Reporting an accessibility problem</h2>
				<p>
					If you encounter an accessibility barrier while using {BRAND.productName}, we want to hear about it. Please contact us at <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a> and describe what you were trying to do, what happened, and which device, browser, and assistive technology you were using. The more detail you provide, the better we can investigate.
				</p>

				<p className="text-sm text-muted-foreground italic">
					This page is provided for informational purposes and does not constitute legal advice.
				</p>
			</div>
		</BasePage>
	);
}
