import type { Metadata } from "next";
import { BRAND, PRODUCT_BY_LINE } from "@/site/brand";
import { BasePage } from "@/app/base-page";

export const metadata: Metadata = {
	title: "Disclaimer",
	description: `Important limitations and disclaimers for ${BRAND.productName}, including caption accuracy and service availability.`,
};

export default function DisclaimerPage() {
	return (
		<BasePage title="Disclaimer" description={`Important limitations of ${BRAND.productName}, including caption accuracy and service availability.`}>
			<div className="prose prose-neutral max-w-none">
				<p className="text-sm text-muted-foreground">Last updated: June 19, 2026</p>

				<p>
					This Disclaimer explains important limitations of {BRAND.productName} (the &quot;Service&quot;). It works alongside our <a href="/terms">Terms of Service</a>. {PRODUCT_BY_LINE}
				</p>

				<h2>Automated captions may contain mistakes</h2>
				<p>
					{BRAND.productName} generates captions automatically using speech recognition. This process is not perfect. Captions may contain errors, omissions, or mishearings, especially when audio is unclear, overlapping, accented, fast-paced, or contains specialized terms, names, or numbers. Automated transcription should never be treated as a perfectly accurate transcript.
				</p>

				<h2>You must review your captions</h2>
				<p>
					You are responsible for reviewing and, where necessary, correcting the captions before you publish, share, or rely on them. The Service provides editing tools so you can fix text and timing. You should not assume that an unedited export is accurate.
				</p>

				<h2>We are not responsible for publication errors</h2>
				<p>
					{BRAND.parentCompany} is not responsible for errors that appear in captions or exports after you publish or distribute them. Once you export a file and publish it elsewhere, you are responsible for the published result, including any captioning errors that were present or that you did not correct.
				</p>

				<h2>Service availability is not guaranteed</h2>
				<p>
					The Service is provided on an &quot;as available&quot; basis. We do not guarantee that {BRAND.productName} will be uninterrupted, error-free, or available at all times. Maintenance, technical problems, capacity limits, or factors outside our control may cause interruptions, slowdowns, or temporary unavailability.
				</p>

				<h2>You are responsible for exported content</h2>
				<p>
					You are responsible for any file you export from the Service and for how you use or distribute it. This includes ensuring that exported captions and videos comply with platform rules where you publish them, and that the underlying content does not infringe the rights of others.
				</p>

				<h2>No warranty</h2>
				<p>
					The Service is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind. To the maximum extent permitted by law, we disclaim all implied warranties, including any warranty of merchantability, fitness for a particular purpose, or non-infringement. See our <a href="/terms">Terms of Service</a> for the full warranty disclaimer.
				</p>

				<h2>No professional advice</h2>
				<p>
					Nothing in the Service constitutes legal, accessibility-compliance, or other professional advice. For example, using captions does not by itself guarantee compliance with any particular accessibility regulation.
				</p>

				<h2>Contact</h2>
				<p>
					For questions about this Disclaimer, contact us at <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>.
				</p>

				<p className="text-sm text-muted-foreground italic">
					This Disclaimer is provided for informational purposes and does not constitute legal advice.
				</p>
			</div>
		</BasePage>
	);
}
