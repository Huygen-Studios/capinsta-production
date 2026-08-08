import type { Metadata } from "next";
import { BRAND, PRODUCT_BY_LINE } from "@/site/brand";
import { BasePage } from "@/app/base-page";

export const metadata: Metadata = {
	title: "Data Retention Policy",
	description: `How long ${BRAND.productName} keeps your uploaded videos, captions, and exports, and when they are deleted.`,
};

export default function DataRetentionPage() {
	return (
		<BasePage title="Data Retention Policy" description={`How long ${BRAND.productName} keeps your data, and when it is automatically deleted.`}>
			<div className="prose prose-neutral max-w-none">
				<p className="text-sm text-muted-foreground">Last updated: June 19, 2026</p>

				<p>
					This Data Retention Policy explains, in plain language, how long {BRAND.productName} (the &quot;Service&quot;) keeps the data you create while using it, and when that data is deleted. {PRODUCT_BY_LINE}
				</p>

				<h2>The short version</h2>
				<p>
					{BRAND.productName} does not keep your projects forever. While you are actively editing, your project is kept alive. If you stop using the editor for 15 minutes, your project and everything attached to it (uploaded video, captions, transcripts, and exports) are deleted automatically and permanently. This happens without anyone having to ask, and the data cannot be recovered afterward.
				</p>

				<h2>Active project lease</h2>
				<p>
					When you start a project, the Service grants it a temporary &quot;lease&quot;. The lease is what allows your project to exist on our servers at all. The lease renews while you remain active, and expires when you become inactive.
				</p>

				<h2>Editor heartbeat</h2>
				<p>
					While you are editing, {BRAND.productName} sends a small keep-alive signal to our servers roughly every 60 seconds. This is called the editor heartbeat. As long as the heartbeat continues, the Service treats your project as active and keeps it alive. The heartbeat carries only a keep-alive indication and is used solely to extend your project lease.
				</p>

				<h2>15-minute inactivity policy</h2>
				<p>
					If no heartbeat is received for 15 minutes, the Service treats the project as inactive. At that point, automatic deletion begins. There is no grace period, no &quot;trash&quot;, and no way to restore a project once it has expired. The 15-minute window is measured from the last detected activity.
				</p>

				<h2>What gets deleted</h2>
				<p>When a project expires, the following are deleted automatically and permanently:</p>
				<ul>
					<li><strong>Uploaded videos.</strong> The video file you uploaded is removed from our servers.</li>
					<li><strong>Captions and transcripts.</strong> The generated text, word-level timing, and any edits you made are removed.</li>
					<li><strong>Exports.</strong> Any rendered captioned video or subtitle file (SRT/VTT) produced from your project is removed.</li>
					<li><strong>Project metadata on the server.</strong> Any server-side record linking these items together is removed.</li>
				</ul>

				<h2>Exceptions while a job is in progress</h2>
				<p>
					A running caption-generation job or a running export job is not deleted while it is in progress, even if the 15-minute timer has elapsed. This prevents an active render or transcription from being interrupted mid-flight. Once the job finishes (or fails), the project becomes subject to normal deletion.
				</p>

				<h2>Local browser storage is not deleted by this policy</h2>
				<p>
					Some lightweight data lives in your own browser, not on our servers. This includes editor preferences, layout settings, and keybindings. This local data does <strong>not</strong> contain your uploaded video files. The inactivity policy described above does not clear data stored locally in your browser; you can clear that yourself at any time through your browser settings.
				</p>

				<h2>Your responsibility to download output</h2>
				<p>
					Because deletion is automatic and permanent, you are responsible for downloading your exported files as soon as they are ready. Once a project has expired, the export, the uploaded video, and the captions cannot be recovered. We strongly recommend downloading your export immediately upon completion.
				</p>

				<h2>Operational and security records</h2>
				<p>
					Separate from your project data, {BRAND.parentCompany} may retain operational logs and security records where needed to keep the Service running safely, investigate abuse, or meet legal obligations. These records are not part of your project and are governed by our <a href="/privacy">Privacy Policy</a>.
				</p>

				<h2>This is automatic and permanent</h2>
				<p>
					All deletion described in this policy is performed automatically by the Service and is permanent. We cannot manually restore expired projects, videos, captions, or exports. If you need a file, download it before your project expires.
				</p>

				<h2>Contact</h2>
				<p>
					For questions about data retention, contact us at <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>.
				</p>

				<p className="text-sm text-muted-foreground italic">
					This Data Retention Policy is provided for informational purposes and does not constitute legal advice.
				</p>
			</div>
		</BasePage>
	);
}
