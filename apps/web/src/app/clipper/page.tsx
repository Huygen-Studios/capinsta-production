import { redirect } from "next/navigation";
import { requireAppPermission } from "@/access/server";
import { ManualClipperWorkspace } from "./manual-workspace";

export const metadata = {
	title: "CapInsta Clipper",
	robots: { index: false, follow: false },
};

export default async function ClipperPage() {
	if (
		!["1", "true", "yes", "on"].includes(
			(process.env.ENABLE_CLIPPER_UI ?? "false").toLowerCase(),
		)
	) {
		redirect("/projects");
	}
	await requireAppPermission("clipper.access", "/clipper");
	return <ManualClipperWorkspace />;
}
