import type { MetadataRoute } from "next";
import { absoluteUrl, siteConfig } from "@/config/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/app/", "/dashboard/", "/editor/", "/account/", "/settings/", "/projects/", "/uploads/", "/exports/", "/admin/"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    host: siteConfig.domain,
  };
}

