import type { Metadata } from "next";
import { BRAND } from "@/site/brand";
import { BasePage } from "@/app/base-page";
import Link from "next/link";

export const metadata: Metadata = {
	title: "Contact",
	description: `Get in touch with the ${BRAND.productName} team.`,
	openGraph: {
		title: `Contact — ${BRAND.productName}`,
		description: `Get in touch with the ${BRAND.productName} team.`,
	},
};

const CONTACT_CATEGORIES = [
	{
		label: "Product support",
		description: "Questions about using Capinsta, caption generation, or exports.",
		email: BRAND.supportEmail,
	},
	{
		label: "Privacy inquiry",
		description: "Questions about data handling, retention, or your rights.",
		email: BRAND.supportEmail,
	},
	{
		label: "Copyright / DMCA notice",
		description: "To report copyrighted content hosted without authorization.",
		email: BRAND.supportEmail,
	},
	{
		label: "Business inquiry",
		description: "Partnership, integration, or other business opportunities.",
		email: BRAND.supportEmail,
	},
];

export default function ContactPage() {
	return (
		<BasePage
			title="Contact us"
			description={`Have a question about ${BRAND.productName}? Reach out and we will respond as soon as possible.`}
		>
			<div className="prose prose-neutral max-w-none">
				<p>
					You can reach the {BRAND.productName} team by email at{" "}
					<a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>.
					Please include as much detail as possible so we can help quickly.
				</p>

				<h2>Contact categories</h2>
				<div className="not-prose space-y-4 mt-4">
					{CONTACT_CATEGORIES.map((cat) => (
						<div
							key={cat.label}
							className="rounded-2xl border-2 border-ink bg-background p-6"
						>
							<h3 className="text-base font-semibold">{cat.label}</h3>
							<p className="mt-1 text-muted-foreground text-sm">
								{cat.description}
							</p>
							<p className="mt-2 text-sm">
								<a
									href={`mailto:${cat.email}?subject=${encodeURIComponent(cat.label + " — " + BRAND.productName)}`}
									className="text-brand font-medium hover:underline"
								>
									{cat.email}
								</a>
							</p>
						</div>
					))}
				</div>

				<h2>Response times</h2>
				<p>
					We aim to respond to all inquiries within a few business days. For urgent
					copyright or DMCA matters, please note &quot;DMCA&quot; in the subject line.
				</p>

				<h2>{BRAND.parentCompany}</h2>
				<p>
					{BRAND.productName} is operated by {BRAND.parentCompany}. For company-level
					inquiries, visit{" "}
					<a href={BRAND.companyWebsite}>{BRAND.companyWebsite}</a>.
				</p>
			</div>
		</BasePage>
	);
}
