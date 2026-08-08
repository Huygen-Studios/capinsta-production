import type { Metadata } from "next";
import { BRAND, PRODUCT_BY_LINE } from "@/site/brand";
import { BasePage } from "@/app/base-page";

export const metadata: Metadata = {
	title: "Privacy Policy",
	description: `How ${BRAND.productName} handles your data, uploaded videos, and generated captions.`,
};

export default function PrivacyPage() {
	return (
		<BasePage title="Privacy Policy" description={`How ${BRAND.productName} and ${BRAND.parentCompany} handle your data.`}>
			<div className="prose prose-neutral max-w-none">
				<p className="text-sm text-muted-foreground">Last updated: June 19, 2026</p>

				<p>
					This Privacy Policy explains how {BRAND.parentCompany} (&quot;we&quot;,
					&quot;us&quot;, or &quot;our&quot;) collects, uses, and protects information when you
					use {BRAND.productName} (the &quot;Service&quot;). {PRODUCT_BY_LINE}
				</p>

				<h2>Operator</h2>
				<p>
					The operator of this Service is {BRAND.parentCompany}. You can contact us at{" "}
					<a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>.
				</p>

				<h2>Information you provide</h2>
				<p>
					When you use {BRAND.productName}, you may provide:
				</p>
				<ul>
					<li><strong>Video files</strong> that you upload for caption generation.</li>
					<li><strong>Edits and preferences</strong> you make to captions and styles.</li>
					<li><strong>Feedback or support requests</strong> you send us by email.</li>
				</ul>
				<p>
					{BRAND.productName} does not currently require an account, login, or email address to
					use the editor.
				</p>

				<h2>How uploaded videos are processed</h2>
				<p>
					When you upload a video, the file is sent to our backend servers so that captions
					can be generated. The audio track is extracted and transmitted to a third-party
					speech recognition provider for transcription. The resulting transcript and
					word-level timing are returned to your browser for editing.
				</p>

				<h2>How captions and transcripts are processed</h2>
				<p>
					Generated captions and transcripts are stored temporarily on our servers
					associated with your active editing session. They are used only to provide the
					captioning service and to generate your exports.
				</p>

				<h2>How exports are processed</h2>
				<p>
					When you request an export, the backend renders either a full captioned video or a
					subtitle file (SRT/VTT). The resulting file is held temporarily so you can download
					it, then deleted according to our retention policy.
				</p>

				<h2>Temporary storage and deletion</h2>
				<p>
					All uploaded videos, captions, transcripts, and generated exports are held only for
					the duration of your active editing session. {BRAND.productName} uses an
					inactivity-based deletion policy: if no activity is detected for 15 minutes, the
					project and all associated files are automatically and permanently deleted.
				</p>
				<p>
					Running caption-generation or export jobs are exempt from deletion while they are in
					progress, to avoid interrupting active processing.
				</p>

				<h2>Browser and local storage</h2>
				<p>
					Some project metadata and preferences (such as editor layout and keybindings) may be
					stored locally in your browser using localStorage or IndexedDB. This local data does
					not contain your uploaded video files. You can clear it at any time through your
					browser settings.
				</p>

				<h2>Cookies</h2>
				<p>
					{BRAND.productName} uses cookies and similar technologies for essential
					functionality. We may also use analytics and advertising cookies, where enabled and
					where you have provided consent. See our <a href="/cookies">Cookie Policy</a> for
					details and to manage your preferences.
				</p>

				<h2>Analytics</h2>
				<p>
					If analytics is enabled, we use a privacy-respecting analytics provider to
					understand aggregate usage (page views, general performance). Analytics data is
					aggregated and does not identify you personally.
				</p>

				<h2>Advertising</h2>
				<p>
					If advertising is enabled, we may display ads through a third-party advertising
					network (such as Google AdSense). If Google advertising cookies are in use, Google
					and its partners may use cookies to serve ads based on your prior visits to this and
					other websites. You can opt out of personalized advertising through your cookie
					preferences or via Google Ads Settings.
				</p>

				<h2>Third-party processors</h2>
				<p>
					We use the following categories of third-party services to operate {BRAND.productName}:
				</p>
				<ul>
					<li><strong>Speech recognition providers</strong> — to convert your video's audio into timed text. Audio data is sent to these providers for transcription.</li>
					<li><strong>Hosting and infrastructure</strong> — to run the backend servers that process uploads and generate exports.</li>
					<li><strong>Analytics and advertising</strong> — where enabled and consented to, as described above.</li>
				</ul>
				<p>
					We do not name specific services beyond those actually in use. Each processor is
					bound by its own privacy and data-handling terms.
				</p>

				<h2>Security limitations</h2>
				<p>
					We take reasonable measures to protect your data during processing and transit.
					However, no method of transmission or storage is completely secure. We cannot
					guarantee absolute security, which is one reason we delete your data promptly after
					inactivity.
				</p>

				<h2>Data retention</h2>
				<p>
					Your uploaded videos, captions, transcripts, and exports are retained only for the
					duration of your active session, and are deleted after 15 minutes of inactivity. See
					our <a href="/data-retention">Data Retention Policy</a> for full details.
				</p>

				<h2>Your rights</h2>
				<p>
					Depending on your location, you may have rights regarding your personal data,
					including the right to access, correct, or request deletion of your data. Because{" "}
					{BRAND.productName} deletes your data automatically after inactivity, most data is
					already gone shortly after you finish. For any specific requests, contact us at{" "}
					<a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>.
				</p>

				<h2>International users</h2>
				<p>
					{BRAND.productName} is available globally. If you access the Service from outside
					the region where our servers are located, your data will be processed in those
					servers. By using the Service, you consent to this transfer.
				</p>

				<h2>Policy updates</h2>
				<p>
					We may update this Privacy Policy from time to time. We will update the
					&quot;Last updated&quot; date above when we do. Continued use of the Service after
					changes constitutes acceptance of the revised policy.
				</p>

				<h2>Contact</h2>
				<p>
					For privacy questions or requests, contact us at{" "}
					<a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>.
				</p>

				<p className="text-sm text-muted-foreground italic">
					This Privacy Policy is provided for informational purposes and does not constitute
					legal advice.
				</p>
			</div>
		</BasePage>
	);
}
