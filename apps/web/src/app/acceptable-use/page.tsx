import type { Metadata } from "next";
import { BRAND, PRODUCT_BY_LINE } from "@/site/brand";
import { BasePage } from "@/app/base-page";

export const metadata: Metadata = {
	title: "Acceptable Use Policy",
	description: `The rules that govern acceptable use of ${BRAND.productName}.`,
};

export default function AcceptableUsePage() {
	return (
		<BasePage title="Acceptable Use Policy" description={`The rules that govern acceptable use of ${BRAND.productName}.`}>
			<div className="prose prose-neutral max-w-none">
				<p className="text-sm text-muted-foreground">Last updated: June 19, 2026</p>

				<p>
					This Acceptable Use Policy describes what you may and may not do while using {BRAND.productName} (the &quot;Service&quot;). It works alongside our <a href="/terms">Terms of Service</a>. {PRODUCT_BY_LINE}
				</p>

				<h2>Your general responsibility</h2>
				<p>
					You agree to use the Service lawfully and respectfully. You are responsible for the content you upload and for how you interact with the Service.
				</p>

				<h2>Prohibited uses</h2>
				<p>You may not use the Service to do any of the following:</p>
				<ul>
					<li><strong>Illegal content.</strong> Upload, caption, or distribute any content that is illegal under applicable law, including content that promotes violence, exploitation, or harm to others.</li>
					<li><strong>Content without proper rights.</strong> Upload or caption videos you do not own or do not have permission to use, including content that infringes the copyright, trademark, privacy, or other rights of any third party.</li>
					<li><strong>Abusive automated usage.</strong> Use bots, scripts, scrapers, or other automated means to access the Service in a way that exceeds normal human use, evades controls, or attempts to extract data at scale.</li>
					<li><strong>Malware.</strong> Upload files that contain viruses, trojans, worms, or any other malicious code, or attempt to use the Service to deliver malware to others.</li>
					<li><strong>Attempts to overload the server.</strong> Send excessive requests, attempt denial-of-service behavior, or otherwise try to strain, disable, or destabilize the Service or its infrastructure.</li>
					<li><strong>Bypassing limits.</strong> Circumvent any rate limit, size limit, export limit, or other technical restriction built into the Service.</li>
					<li><strong>Unauthorized access.</strong> Attempt to gain access to systems, data, accounts, or areas of the Service that you are not authorized to reach, including probing, scanning, or testing for vulnerabilities.</li>
					<li><strong>Harmful or deceptive content.</strong> Upload or generate content that is defamatory, harassing, threatening, hateful, deceptive, fraudulent, or that otherwise seeks to mislead or harm people.</li>
					<li><strong>Abuse of the free service.</strong> Resell, sublicense, or otherwise attempt to commercialize access to the free Service itself, or otherwise abuse the fact that the Service is provided free of charge.</li>
				</ul>

				<h2>Enforcement</h2>
				<p>
					Violating this policy may result in suspension or termination of your access to the Service, deletion of offending projects, or other action we consider appropriate. We reserve the right to take action without notice where we believe it is necessary to protect the Service, our users, or third parties.
				</p>

				<h2>Reporting violations</h2>
				<p>
					If you become aware of content or activity that violates this policy, please contact us at <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>.
				</p>

				<p className="text-sm text-muted-foreground italic">
					This Acceptable Use Policy is provided for informational purposes and does not constitute legal advice.
				</p>
			</div>
		</BasePage>
	);
}
