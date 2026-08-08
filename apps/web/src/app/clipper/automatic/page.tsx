import { requireAppPermission } from "@/access/server";
import { ClipperWorkspace } from "../workspace";

export const metadata = { title: "Suggest clips with AI", robots: { index: false, follow: false } };

export default async function AutomaticClipperPage() {
	await requireAppPermission("clipper.access", "/clipper/automatic");
	return <ClipperWorkspace />;
}
