import type { MetadataRoute } from "next";
import { SITE_URL } from "@/site/brand";

export default function robots(): MetadataRoute.Robots {
	return {
		rules: {
			userAgent: "*",
			allow: "/",
			disallow: [
				"/_next/",
				"/projects/",
				"/editor/",
				"/render",
				"/api/",
				"/caption-sync-verify",
			],
		},
		sitemap: `${SITE_URL}/sitemap.xml`,
	};
}
