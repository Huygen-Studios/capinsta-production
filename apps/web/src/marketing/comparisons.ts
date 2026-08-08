export interface VerifiedClaim {
	label: string;
	capinsta: string;
	competitor: string;
	status: "verified" | "provider-dependent";
	sourceUrl?: string;
}

export interface CompetitorComparison {
	slug: string;
	competitor: string;
	title: string;
	description: string;
	summary: string;
	capinstaFor: string[];
	competitorFor: string[];
	claims: VerifiedClaim[];
	pros: string[];
	cons: string[];
	sourceUrls: string[];
	lastVerified: string;
}

const capinstaRows = [
	{
		label: "Product focus",
		capinsta: "Focused browser workflow for generating, timing, and styling captions.",
		status: "verified" as const,
	},
	{
		label: "Capinsta pricing",
		capinsta: "Currently free during public beta.",
		status: "verified" as const,
	},
];

export const COMPARISONS: CompetitorComparison[] = [
	{
		slug: "capinsta-vs-kapwing",
		competitor: "Kapwing",
		title: "Capinsta vs Kapwing",
		description: "An honest comparison of Capinsta and Kapwing for automatic subtitles and styled video captions.",
		summary: "Capinsta is a focused caption studio. Kapwing is a broader collaborative online video editor.",
		capinstaFor: ["Creators who primarily need animated captions", "Word-level timing and preset styling", "A focused, lower-complexity workflow"],
		competitorFor: ["Teams needing a broader editing suite", "Collaborative content workflows", "Projects that extend well beyond caption styling"],
		claims: [
			...capinstaRows.map((row) => ({ ...row, competitor: "—" })),
			{ label: "Competitor pricing", capinsta: "—", competitor: "See current provider pricing", status: "provider-dependent", sourceUrl: "https://www.kapwing.com/pricing" },
			{ label: "Automatic subtitles", capinsta: "Available", competitor: "Available", status: "verified", sourceUrl: "https://www.kapwing.com/subtitles" },
		],
		pros: ["Focused caption creation", "Animated public preset library", "Currently free during public beta"],
		cons: ["Smaller overall editing feature set", "Public beta product", "Not intended to replace a full collaborative editor"],
		sourceUrls: ["https://www.kapwing.com/pricing", "https://www.kapwing.com/subtitles"],
		lastVerified: "June 21, 2026",
	},
	{
		slug: "capinsta-vs-veed",
		competitor: "VEED",
		title: "Capinsta vs VEED",
		description: "Compare Capinsta with VEED for browser-based subtitles, caption styling, and wider video editing.",
		summary: "Capinsta keeps caption work front and center. VEED offers a wider browser-based video production suite.",
		capinstaFor: ["Short-form creators focused on captions", "Creators who want direct preset styling", "Users who prefer a compact caption workflow"],
		competitorFor: ["Users seeking a broader online editor", "Teams combining subtitles with wider video production", "Workflows needing provider-specific plan features"],
		claims: [
			...capinstaRows.map((row) => ({ ...row, competitor: "—" })),
			{ label: "Competitor pricing", capinsta: "—", competitor: "See current provider pricing", status: "provider-dependent", sourceUrl: "https://www.veed.io/pricing" },
			{ label: "Automatic subtitles", capinsta: "Available", competitor: "Available", status: "verified", sourceUrl: "https://www.veed.io/tools/auto-subtitle-generator-online" },
		],
		pros: ["Caption-first interface", "Editable animated caption presets", "Currently free during public beta"],
		cons: ["Not a complete general-purpose video suite", "Beta availability may evolve", "Fewer team-oriented publishing tools"],
		sourceUrls: ["https://www.veed.io/pricing", "https://www.veed.io/tools/auto-subtitle-generator-online"],
		lastVerified: "June 21, 2026",
	},
	{
		slug: "capinsta-vs-captions-ai",
		competitor: "Captions AI",
		title: "Capinsta vs Captions AI",
		description: "Compare Capinsta and Captions AI for creator captions, browser access, and caption styling.",
		summary: "Capinsta offers a browser-based caption editor. Captions AI publishes a wider set of AI creator products and plans.",
		capinstaFor: ["Browser-first caption editing", "Hands-on word timing and caption styling", "Creators who want transparent preset controls"],
		competitorFor: ["Creators evaluating a broader AI creation suite", "Users who prefer the competitor's supported platforms", "Workflows tied to provider-specific AI features"],
		claims: [
			...capinstaRows.map((row) => ({ ...row, competitor: "—" })),
			{ label: "Competitor pricing", capinsta: "—", competitor: "See current provider plans", status: "provider-dependent", sourceUrl: "https://www.captions.ai/plans" },
			{ label: "Current plan details", capinsta: "Public beta", competitor: "Verify with provider", status: "provider-dependent", sourceUrl: "https://www.captions.ai/plans" },
		],
		pros: ["Runs in the browser", "Fine-grained caption styling", "Currently free during public beta"],
		cons: ["Public beta product", "Narrower AI toolset", "Platform scope differs from a broader creator suite"],
		sourceUrls: ["https://www.captions.ai/plans"],
		lastVerified: "June 21, 2026",
	},
];

export function getComparison(slug: string) {
	return COMPARISONS.find((item) => item.slug === slug);
}
