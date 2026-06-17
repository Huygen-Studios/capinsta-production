import type { MetadataRoute } from "next";
import { absoluteUrl, publicRoutes } from "@/config/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return publicRoutes.map((route) => ({
    url: absoluteUrl(route),
    lastModified: new Date("2026-06-07"),
    changeFrequency: route === "/" ? "weekly" : "monthly",
    priority: route === "/" ? 1 : route.includes("generator") ? 0.8 : 0.6,
  }));
}

