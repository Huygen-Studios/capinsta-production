import { requireAppPermission } from "@/access/server";
import type { Metadata } from "next";
import { RenderPageClient } from "./render-client";

export const metadata: Metadata = {
	title: "CapInsta Render",
	robots: { index: false, follow: false, nocache: true, noarchive: true },
};

export default async function RenderPage() {
	await requireAppPermission("render.access", "/render");
	return <RenderPageClient />;
}
