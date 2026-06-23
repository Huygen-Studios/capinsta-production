import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { ComingSoonPage, MaintenancePage } from "@/components/access/access-pages";
import { Hero } from "@/components/landing/hero";
import {
	FeaturesSection,
	HowItWorksSection,
	CaptionWorkflowsSection,
	EditingExportSection,
	PrivacySection,
	WhyFreeSection,
	FaqSection,
	FinalCtaSection,
} from "@/components/landing/sections";
import type { Metadata } from "next";
import { BRAND, FULL_DESCRIPTION, SITE_URL } from "@/site/brand";
import { PresetShowcase } from "@/components/landing/preset-showcase";
import { StructuredData } from "@/components/structured-data";
import { getSiteAccessPolicy } from "@/access/server";

export const metadata: Metadata = {
	title: {
		default: `${BRAND.productName} — Animated captions in your browser`,
		template: `%s — ${BRAND.productName}`,
	},
	description: FULL_DESCRIPTION,
	alternates: {
		canonical: SITE_URL,
	},
};

export const dynamic = "force-dynamic";

export default async function Home() {
	const policy = await getSiteAccessPolicy();
	if (policy.mode === "coming_soon") return <ComingSoonPage policy={policy} />;
	if (policy.mode === "maintenance") return <MaintenancePage policy={policy} />;
	return (
		<div className="marketing-theme">
			<StructuredData />
			<Header />
			<main>
				<Hero />
				<FeaturesSection />
				<PresetShowcase />
				<HowItWorksSection />
				<CaptionWorkflowsSection />
				<EditingExportSection />
				<PrivacySection />
				<WhyFreeSection />
				<FaqSection />
				<FinalCtaSection />
			</main>
			<Footer />
		</div>
	);
}
