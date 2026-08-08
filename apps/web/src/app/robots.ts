import type { MetadataRoute } from "next";
import { SITE_URL } from "@/site/brand";

export default function robots(): MetadataRoute.Robots {
	return {
		rules: {
			userAgent: "*",
			allow: "/",
			disallow: [
				"/projects/",
				"/projects",
				"/editor/",
				"/editor",
				"/render",
				"/api/",
				"/caption-sync-verify",
				"/internal/",
			],
		},
		sitemap: `${SITE_URL}/sitemap.xml`,
	};
}
