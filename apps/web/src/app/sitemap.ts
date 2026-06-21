import { SITE_URL, ROUTES } from "@/site/brand";
import { getPosts } from "@/blog/query";
import type { MetadataRoute } from "next";

/**
 * Public sitemap. Includes all indexable public pages (landing, company,
 * guides, FAQ, legal) and blog posts. Excludes:
 *  - /projects, /editor (private session routes)
 *  - /render (internal export page)
 *  - /api/* (API routes)
 *  - /ads.txt (only when configured; not a page)
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	const now = new Date();

	const staticPages: MetadataRoute.Sitemap = [
		{ url: SITE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
		{ url: `${SITE_URL}${ROUTES.features}`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
		{ url: `${SITE_URL}${ROUTES.howItWorks}`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
		{ url: `${SITE_URL}${ROUTES.guides}`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
		{ url: `${SITE_URL}${ROUTES.faq}`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
		{ url: `${SITE_URL}${ROUTES.about}`, lastModified: now, changeFrequency: "yearly", priority: 0.6 },
		{ url: `${SITE_URL}${ROUTES.contact}`, lastModified: now, changeFrequency: "yearly", priority: 0.6 },
		{ url: `${SITE_URL}/blog`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
		{ url: `${SITE_URL}/changelog`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
		{ url: `${SITE_URL}${ROUTES.captionGenerator}`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
		{ url: `${SITE_URL}${ROUTES.autoSubtitleGenerator}`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
		{ url: `${SITE_URL}${ROUTES.animatedCaptionGenerator}`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
		{ url: `${SITE_URL}${ROUTES.captionPresets}`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
		{ url: `${SITE_URL}${ROUTES.compare}`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
		{ url: `${SITE_URL}${ROUTES.brand}`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
		{ url: `${SITE_URL}/compare/capinsta-vs-kapwing`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
		{ url: `${SITE_URL}/compare/capinsta-vs-veed`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
		{ url: `${SITE_URL}/compare/capinsta-vs-captions-ai`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
		// Legal
		{ url: `${SITE_URL}${ROUTES.privacy}`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
		{ url: `${SITE_URL}${ROUTES.terms}`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
		{ url: `${SITE_URL}${ROUTES.cookies}`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
		{ url: `${SITE_URL}${ROUTES.dataRetention}`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
		{ url: `${SITE_URL}${ROUTES.acceptableUse}`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
		{ url: `${SITE_URL}${ROUTES.disclaimer}`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
		{ url: `${SITE_URL}${ROUTES.copyright}`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
		{ url: `${SITE_URL}${ROUTES.accessibility}`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
	];

	const postPages: MetadataRoute.Sitemap =
		(await getPosts().catch(() => null))?.posts?.map((post) => ({
			url: `${SITE_URL}/blog/${post.slug}`,
			lastModified: new Date(post.publishedAt),
			changeFrequency: "monthly" as const,
			priority: 0.6,
		})) ?? [];

	return [...staticPages, ...postPages];
}
