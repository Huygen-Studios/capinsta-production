import type { Metadata } from "next";
import { BRAND, PRODUCT_BY_LINE } from "@/site/brand";
import { BasePage } from "@/app/base-page";

export const metadata: Metadata = {
	title: "Terms of Service",
	description: `The terms that govern your use of ${BRAND.productName}.`,
};

export default function TermsPage() {
	return (
		<BasePage title="Terms of Service" description={`The terms governing your use of ${BRAND.productName}.`}>
			<div className="prose prose-neutral max-w-none">
				<p className="text-sm text-muted-foreground">Last updated: June 19, 2026</p>

				<h2>Acceptance of terms</h2>
				<p>
					By accessing or using {BRAND.productName} (the &quot;Service&quot;), you agree to be
					bound by these Terms of Service. If you do not agree, do not use the Service.{" "}
					{PRODUCT_BY_LINE}
				</p>

				<h2>Service description</h2>
				<p>
					{BRAND.productName} is a free, browser-based tool for generating, editing, styling,
					and exporting video captions. The Service processes uploaded videos to produce
					accurate captions with word-level timing and active-word highlighting.
				</p>

				<h2>Free service availability</h2>
				<p>
					The Service is provided free of charge. We do not guarantee that the Service will
					always be available, uninterrupted, or free of errors. We may modify, suspend, or
					discontinue the Service, or any part of it, at any time without notice.
				</p>

				<h2>Temporary project storage</h2>
				<p>
					Projects you create are stored temporarily on our servers. The Service uses an
					inactivity-based retention model. Uploaded videos, captions, transcripts, and
					generated exports are automatically deleted after a period of inactivity
					(currently 15 minutes).
				</p>

				<h2>Automatic deletion after inactivity</h2>
				<p>
					You acknowledge and agree that the Service will automatically and permanently
					delete your project, uploaded video, generated captions, transcripts, and exports
					after 15 minutes of inactivity. We are not responsible for any loss of data
					resulting from this automatic deletion.
				</p>

				<h2>Your responsibility to download exports</h2>
				<p>
					You are solely responsible for downloading your exported files before the project
					expires. Once a project is deleted, the data cannot be recovered. We strongly
					recommend downloading your export immediately upon completion.
				</p>

				<h2>User ownership of uploaded media</h2>
				<p>
					You retain all ownership rights to the videos and content you upload to the
					Service. We do not claim ownership of your uploaded media. Your media is used
					solely to provide the captioning service and is deleted after inactivity as
					described above.
				</p>

				<h2>Your responsibility for copyright permissions</h2>
				<p>
					You are solely responsible for ensuring you have the necessary rights and
					permissions to upload and caption the videos you submit. You represent that your
					use of the Service does not infringe the intellectual property rights of any third
					party.
				</p>

				<h2>Permitted use</h2>
				<p>You may use the Service to:</p>
				<ul>
					<li>Generate captions for videos you own or have permission to caption.</li>
					<li>Edit, style, and export captions for personal or commercial projects.</li>
					<li>Use exported caption files in other software or platforms.</li>
				</ul>

				<h2>Prohibited use</h2>
				<p>
					You may not use the Service to upload, caption, or distribute content that is
					illegal, infringing, harmful, or that you do not have the right to use. See our{" "}
					<a href="/acceptable-use">Acceptable Use Policy</a> for the full list of
					prohibitions.
				</p>

				<h2>Service availability</h2>
				<p>
					The Service is provided on an &quot;as available&quot; basis. We do not guarantee
					uninterrupted access. Maintenance, technical issues, or external factors may cause
					interruptions.
				</p>

				<h2>Export limitations</h2>
				<p>
					Export quality and file size may be limited by the free nature of the Service. Very
					large or long videos may take longer to process or may not be supported.
				</p>

				<h2>Disclaimer of warranties</h2>
				<p>
					The Service is provided &quot;as is&quot; and &quot;as available&quot; without
					warranties of any kind, whether express or implied. We do not warrant that the
					Service will be error-free, that captions will be accurate, or that the Service
					will meet your specific requirements. See our <a href="/disclaimer">Disclaimer</a>{" "}
					for more information.
				</p>

				<h2>Limitation of liability</h2>
				<p>
					To the maximum extent permitted by law, {BRAND.parentCompany} shall not be liable
					for any indirect, incidental, special, consequential, or punitive damages, or any
					loss of data, arising from your use of or inability to use the Service.
				</p>

				<h2>Termination</h2>
				<p>
					You may stop using the Service at any time. We may suspend or terminate your
					access to the Service at any time, without notice, for any reason.
				</p>

				<h2>Policy changes</h2>
				<p>
					We may update these Terms from time to time. We will update the &quot;Last
					updated&quot; date above. Continued use of the Service after changes constitutes
					acceptance of the revised Terms.
				</p>

				<h2>Governing law</h2>
				<p className="text-sm">
					<em>
						Governing law and jurisdiction: [Placeholder — to be completed by the owner with
						the appropriate legal jurisdiction and dispute resolution terms.]
					</em>
				</p>

				<h2>Contact</h2>
				<p>
					For questions about these Terms, contact us at{" "}
					<a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>.
				</p>

				<p className="text-sm text-muted-foreground italic">
					These Terms are provided for informational purposes and do not constitute legal
					advice.
				</p>
			</div>
		</BasePage>
	);
}
