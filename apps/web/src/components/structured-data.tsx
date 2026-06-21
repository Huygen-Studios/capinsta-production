import { BRAND, SITE_URL, SITE_INFO } from "@/site/brand";

/**
 * JSON-LD structured data for Capinsta.
 *
 * Renders Organization (Huygen Studios), WebSite, and SoftwareApplication
 * schemas. Does NOT include fake ratings, review counts, prices, or awards —
 * the application is free with no aggregated reviews.
 */

export const organizationSchema = {
	"@context": "https://schema.org",
	"@type": "Organization",
	name: BRAND.parentCompany,
	url: BRAND.companyWebsite,
	brand: {
		"@type": "Brand",
		name: BRAND.productName,
	},
};

export const websiteSchema = {
	"@context": "https://schema.org",
	"@type": "WebSite",
	name: BRAND.productName,
	url: SITE_URL,
	description: SITE_INFO.description,
	publisher: {
		"@type": "Organization",
		name: BRAND.parentCompany,
		url: BRAND.companyWebsite,
	},
};

export const softwareSchema = {
	"@context": "https://schema.org",
	"@type": "SoftwareApplication",
	name: BRAND.productName,
	applicationCategory: "MultimediaApplication",
	operatingSystem: "Web (browser-based)",
	url: SITE_URL,
	description: SITE_INFO.description,
	offers: {
		"@type": "Offer",
		price: "0",
		priceCurrency: "USD",
	},
	publisher: {
		"@type": "Organization",
		name: BRAND.parentCompany,
		url: BRAND.companyWebsite,
	},
};

function assertProductionUrl(url: string) {
	const parsed = new URL(url);
	if (parsed.origin !== SITE_URL) {
		throw new Error(`Structured data URL must use ${SITE_URL}`);
	}
	return url;
}

export function buildArticleSchema({
	headline,
	description,
	path,
	datePublished,
	dateModified,
}: {
	headline: string;
	description: string;
	path: string;
	datePublished: string;
	dateModified: string;
}) {
	const url = assertProductionUrl(new URL(path, SITE_URL).toString());
	return {
		"@context": "https://schema.org",
		"@type": "Article",
		headline,
		description,
		url,
		mainEntityOfPage: url,
		datePublished,
		dateModified,
		author: { "@type": "Organization", name: BRAND.parentCompany },
		publisher: {
			"@type": "Organization",
			name: BRAND.parentCompany,
			url: BRAND.companyWebsite,
		},
	};
}

export function JsonLd({ data }: { data: Record<string, unknown> }) {
	return (
		<script
			type="application/ld+json"
			dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
		/>
	);
}

/** Render all base schemas on the page (typically in <head> via layout). */
export function StructuredData() {
	return (
		<>
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
			/>
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
			/>
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }}
			/>
		</>
	);
}

export function ArticleStructuredData(
	props: Parameters<typeof buildArticleSchema>[0],
) {
	return <JsonLd data={buildArticleSchema(props)} />;
}

/** FAQPage schema for pages that render visible FAQ content. */
export function FaqStructuredData({
	questions,
}: {
	questions: { question: string; answer: string }[];
}) {
	const schema = {
		"@context": "https://schema.org",
		"@type": "FAQPage",
		mainEntity: questions.map((q) => ({
			"@type": "Question",
			name: q.question,
			acceptedAnswer: {
				"@type": "Answer",
				text: q.answer,
			},
		})),
	};
	return (
		<script
			type="application/ld+json"
			dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
		/>
	);
}

/** BreadcrumbList schema for guide/legal pages. */
export function BreadcrumbStructuredData({
	items,
}: {
	items: { name: string; url: string }[];
}) {
	const schema = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: items.map((item, index) => ({
			"@type": "ListItem",
			position: index + 1,
			name: item.name,
			item: item.url,
		})),
	};
	return (
		<script
			type="application/ld+json"
			dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
		/>
	);
}
