import { redirect } from "next/navigation";
import { requireAppPermission } from "@/access/server";
import { ClipperWorkspace } from "./workspace";

export const metadata = {
	title: "Automatic Clipper",
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
	return <ClipperWorkspace />;
}
