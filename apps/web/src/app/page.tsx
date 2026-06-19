import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
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

export default function Home() {
	return (
		<div>
			<Header />
			<main>
				<Hero />
				<FeaturesSection />
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
