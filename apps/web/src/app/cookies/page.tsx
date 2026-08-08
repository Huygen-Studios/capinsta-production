import type { Metadata } from "next";
import { BRAND, PRODUCT_BY_LINE } from "@/site/brand";
import { BasePage } from "@/app/base-page";

export const metadata: Metadata = {
	title: "Cookie Policy",
	description: `How ${BRAND.productName} uses cookies, local storage, and how you can manage your consent choices.`,
};

export default function CookiesPage() {
	return (
		<BasePage title="Cookie Policy" description={`How ${BRAND.productName} uses cookies and local storage, and how you control them.`}>
			<div className="prose prose-neutral max-w-none">
				<p className="text-sm text-muted-foreground">Last updated: June 19, 2026</p>

				<p>
					This Cookie Policy explains how {BRAND.parentCompany} (&quot;we&quot;,
					&quot;us&quot;, or &quot;our&quot;) uses cookies and similar technologies when you
					use {BRAND.productName} (the &quot;Service&quot;). {PRODUCT_BY_LINE}
				</p>

				<h2>What are cookies and local storage</h2>
				<p>
					Cookies are small text files placed on your device by a website. Browsers also offer
					similar mechanisms such as <code>localStorage</code> and <code>IndexedDB</code>, which
					let a site store information directly in your browser. This policy covers both cookies
					and these browser-storage technologies.
				</p>

				<h2>Categories we may use</h2>
				<ul>
					<li>
						<strong>Necessary storage.</strong> Storage required for the editor to function, such as remembering your editor layout, keybindings, and theme, and keeping your active editing session stable. This storage remains active at all times and cannot be disabled.
					</li>
					<li>
						<strong>Analytics cookies.</strong> Where enabled, these let us understand aggregate usage. Analytics data is aggregated and does not identify you personally.
					</li>
					<li>
						<strong>Advertising cookies.</strong> Where enabled, these may be used by a third-party ad network to select and measure ads.
					</li>
					<li>
						<strong>Google advertising cookies.</strong> If Google AdSense is enabled, Google and its partners may use cookies to serve ads based on your visits to this and other websites. You can opt out of personalized ads through Google Ads Settings.
					</li>
				</ul>

				<h2>Consent before non-essential cookies</h2>
				<p>
					Analytics and Advertising cookies are non-essential. They do not load before you have given consent. The first time you visit the Service, you are asked which non-essential categories you accept. Only the categories you accept are activated.
				</p>

				<h2>Necessary storage is always on</h2>
				<p>
					Necessary storage stays active regardless of your consent choices, because it powers the core editor. Rejecting analytics or advertising does not block the core editor, and your uploaded videos, captions, and exports continue to be processed and stored temporarily as described in our <a href="/data-retention">Data Retention Policy</a> and <a href="/privacy">Privacy Policy</a>.
				</p>

				<h2>Withdrawing consent</h2>
				<p>
					You can change your cookie preferences at any time. Use the <strong>Cookie preferences</strong> link in the footer to reopen the consent banner and accept or reject any category. Rejecting non-essential cookies is just as clear and easy as accepting them.
				</p>

				<h2>Browser controls</h2>
				<p>
					You can also control or delete cookies and browser storage through your browser settings. Most browsers let you refuse new cookies, delete existing ones, or browse in a private mode. Note that disabling necessary storage may prevent the editor from working correctly.
				</p>

				<h2>What local storage contains</h2>
				<p>
					The data {BRAND.productName} stores locally in your browser is limited to editor preferences, layout, keybindings, and similar lightweight settings. Your uploaded video files are not stored in local browser storage.
				</p>

				<h2>Updates to this policy</h2>
				<p>
					We may update this Cookie Policy from time to time. We will update the &quot;Last updated&quot; date above when we do.
				</p>

				<h2>Contact</h2>
				<p>
					For questions about cookies or consent, contact us at <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>.
				</p>

				<p className="text-sm text-muted-foreground italic">
					This Cookie Policy is provided for informational purposes and does not constitute legal advice.
				</p>
			</div>
		</BasePage>
	);
}
