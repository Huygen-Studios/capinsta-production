import type { Metadata } from "next";
import { BasePage } from "@/app/base-page";
import { BRAND, ROUTES } from "@/site/brand";
import Link from "next/link";

export const metadata: Metadata = {
	title: "Advertising disclosure",
	description: "How Capinsta may use clearly labeled advertising and how advertising consent choices are handled.",
	alternates: { canonical: ROUTES.advertising },
};

export default function AdvertisingPage() {
	return (
		<BasePage
			title="Advertising disclosure"
			description="How advertising may support Capinsta without becoming part of the editor controls."
		>
			<div className="prose prose-neutral dark:prose-invert max-w-none">
				<h2>Current status</h2>
				<p>
					Advertising infrastructure is prepared, but advertisements are not enabled
					unless valid production configuration and required consent are present.
					{BRAND.productName} does not use fake advertiser content in development.
				</p>
				<h2>Placement principles</h2>
				<p>
					Advertisements, when enabled, are labeled and visually separated from editing
					controls. They are not placed in video previews, timelines, caption cards,
					dialogs, authentication screens, error pages, or render pages.
				</p>
				<h2>Privacy choices</h2>
				<p>
					Advertising storage remains denied by default. Where advertising consent is
					required, Capinsta must use an appropriate consent solution before loading
					advertising. You can reopen cookie preferences from the site footer.
				</p>
				<p>
					Read the <Link href={ROUTES.privacy}>Privacy Policy</Link> and{" "}
					<Link href={ROUTES.cookies}>Cookie Policy</Link> for additional details.
				</p>
			</div>
		</BasePage>
	);
}
