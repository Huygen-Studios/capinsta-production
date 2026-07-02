import Link from "next/link";
import Image from "next/image";
import {
	PRODUCT_BY_LINE,
	copyrightLine,
	ROUTES,
	BRAND,
	LOGOS,
} from "@/site/brand";
import { CookiePreferencesButton } from "./cookie-consent";

type FooterLink = { label: string; href: string };

type FooterSection = { heading: string; links: FooterLink[] };

const footerSections: FooterSection[] = [
	{
		heading: "Product",
		links: [
			{ label: "Features", href: ROUTES.features },
			{ label: "How It Works", href: ROUTES.howItWorks },
			{ label: "Guides", href: ROUTES.guides },
			{ label: "FAQ", href: ROUTES.faq },
			{ label: "Caption presets", href: ROUTES.captionPresets },
			{ label: "Pricing", href: "/pricing" },
			{ label: "Compare tools", href: ROUTES.compare },
			{ label: "Open Capinsta", href: ROUTES.projects },
		],
	},
	{
		heading: "Company",
		links: [
			{ label: "About", href: ROUTES.about },
			{ label: "Contact", href: ROUTES.contact },
			{ label: "Brand assets", href: ROUTES.brand },
			{ label: "Donate", href: "/donate" },
			{ label: BRAND.parentCompany, href: BRAND.companyWebsite },
		],
	},
	{
		heading: "Legal",
		links: [
			{ label: "Privacy Policy", href: ROUTES.privacy },
			{ label: "Terms of Service", href: ROUTES.terms },
			{ label: "Cookie Policy", href: ROUTES.cookies },
			{ label: "Advertising disclosure", href: ROUTES.advertising },
			{ label: "Data Retention Policy", href: ROUTES.dataRetention },
			{ label: "Acceptable Use Policy", href: ROUTES.acceptableUse },
			{ label: "Disclaimer", href: ROUTES.disclaimer },
		],
	},
	{
		heading: "More",
		links: [
			{ label: "Accessibility", href: ROUTES.accessibility },
			{ label: "Copyright / DMCA", href: ROUTES.copyright },
		],
	},
];

export function Footer() {
	return (
		<footer className="border-t border-border bg-background">
			<div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
				<div className="grid grid-cols-2 gap-8 md:grid-cols-4">
					{footerSections.map((section) => (
						<div key={section.heading}>
							<h3 className="text-foreground mb-4 text-sm font-semibold tracking-wide uppercase">
								{section.heading}
							</h3>
							<ul className="space-y-2.5">
								{section.links.map((link) => (
									<li key={link.href + link.label}>
										<Link
											href={link.href}
											className="text-muted-foreground hover:text-foreground text-sm transition-colors"
											target={
												link.href.startsWith("http")
													? "_blank"
													: undefined
											}
											rel={
												link.href.startsWith("http")
													? "noopener noreferrer"
													: undefined
											}
										>
											{link.label}
										</Link>
									</li>
								))}
							</ul>
						</div>
					))}
				</div>

				{/* Bottom bar */}
					<div className="border-t border-border mt-12 flex flex-col items-center justify-between gap-4 pt-8 sm:flex-row">
						<div className="flex items-center gap-3">
							<Image
								src={LOGOS.mark}
								alt={BRAND.productName}
								width={24}
								height={24}
								className="object-contain"
							/>
							<span className="text-foreground text-sm font-semibold">
								{BRAND.productName}
							</span>
							<span className="text-muted-foreground text-sm">
								{PRODUCT_BY_LINE}
							</span>
						</div>
						<div className="flex items-center gap-4">
							<CookiePreferencesButton />
							<p className="text-muted-foreground text-sm">
								{copyrightLine()}
							</p>
						</div>
					</div>
			</div>
		</footer>
	);
}
