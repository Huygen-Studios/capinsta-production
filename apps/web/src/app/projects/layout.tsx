import { requireAppPermission } from "@/access/server";

export default async function ProjectsLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	await requireAppPermission("projects.access", "/projects");
	return children;
}
