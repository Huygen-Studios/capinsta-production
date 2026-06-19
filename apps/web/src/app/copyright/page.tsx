import type { Metadata } from "next";
import { BRAND, PRODUCT_BY_LINE } from "@/site/brand";
import { BasePage } from "@/app/base-page";

export const metadata: Metadata = {
	title: "Copyright / DMCA",
	description: `How to report copyright infringement on ${BRAND.productName}, and how counter-notices work.`,
};

export default function CopyrightPage() {
	return (
		<BasePage title="Copyright / DMCA" description={`How to report copyright infringement on ${BRAND.productName}.`}>
			<div className="prose prose-neutral max-w-none">
				<p className="text-sm text-muted-foreground">Last updated: June 19, 2026</p>

				<p>
					{BRAND.parentCompany} respects the intellectual property rights of others and expects users of {BRAND.productName} (the &quot;Service&quot;) to do the same. This page explains how to report content that you believe infringes your copyright. {PRODUCT_BY_LINE}
				</p>

				<h2>Your responsibility for uploads</h2>
				<p>
					You are responsible for ensuring that the videos you upload to the Service are ones you own or have permission to use. Uploading or captioning content that infringes someone else&apos;s copyright is prohibited under our <a href="/acceptable-use">Acceptable Use Policy</a> and <a href="/terms">Terms of Service</a>.
				</p>

				<h2>Reporting copyright infringement</h2>
				<p>
					If you believe that content available through the Service infringes a copyright that you own or control, you may send us a copyright complaint. We will review valid complaints and may remove or disable access to the allegedly infringing material.
				</p>
				<p>
					To help us act quickly, please send your complaint by email to <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a> and include all of the information listed below.
				</p>

				<h2>Required information for a complaint</h2>
				<p>Your copyright complaint must include the following:</p>
				<ul>
					<li><strong>Identification of the copyrighted work.</strong> A description of the original work that you claim has been infringed. If multiple works are involved, please provide a representative list.</li>
					<li><strong>Identification of the infringing material.</strong> A description of the material that you claim is infringing, including enough information (such as a URL or project reference) for us to locate it on the Service.</li>
					<li><strong>Your contact information.</strong> Your full name, mailing address, telephone number, and email address so that we can reach you.</li>
					<li><strong>Good-faith belief statement.</strong> A statement that you have a good-faith belief that the disputed use is not authorized by the copyright owner, its agent, or the law.</li>
					<li><strong>Accuracy and perjury statement.</strong> A statement, made under penalty of perjury, that the information in your complaint is accurate and that you are the owner of the copyright or are authorized to act on the owner&apos;s behalf.</li>
					<li><strong>Signature.</strong> A physical or electronic signature of the copyright owner or a person authorized to act on their behalf.</li>
				</ul>

				<h2>Designated agent</h2>
				<p className="text-sm">
					<em>
						[Placeholder — Designated DMCA agent: If {BRAND.parentCompany} is designated under 17 U.S.C. § 512(c), the DMCA agent&apos;s name and current registration details will be listed here by the owner. Until a designation is in place, copyright complaints should be sent to the contact email above. Do not assume a US DMCA agent is currently registered unless this placeholder is replaced with verified registration details.]
					</em>
				</p>

				<h2>Counter-notice</h2>
				<p>
					If you believe that your content was removed or disabled because of a mistake or misidentification, you may submit a counter-notice. A counter-notice should be sent to <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a> and should include:
				</p>
				<ul>
					<li>Your physical or electronic signature.</li>
					<li>Identification of the material that was removed and the location at which it appeared.</li>
					<li>A statement, made under penalty of perjury, that you have a good-faith belief that the material was removed or disabled as a result of mistake or misidentification.</li>
					<li>Your name, address, telephone number, and email address, and a statement that you consent to the jurisdiction of an appropriate court.</li>
				</ul>

				<h2>Repeat infringers</h2>
				<p>
					In appropriate circumstances, we may terminate access for users who are determined to be repeat infringers.
				</p>

				<h2>False claims</h2>
				<p>
					Please make sure your complaint or counter-notice is accurate before you submit it. Making knowing, material misrepresentations in a copyright complaint or counter-notice may result in legal liability for damages.
				</p>

				<h2>Contact</h2>
				<p>
					For copyright questions, contact us at <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>.
				</p>

				<p className="text-sm text-muted-foreground italic">
					This page is provided for informational purposes and does not constitute legal advice.
				</p>
			</div>
		</BasePage>
	);
}
