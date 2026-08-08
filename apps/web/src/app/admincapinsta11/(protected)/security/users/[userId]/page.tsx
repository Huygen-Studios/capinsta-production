import { notFound } from "next/navigation";
import { isUuid } from "@/admin/routes";
import { AdminDetailPage } from "@/components/admin/admin-detail-page";

export default async function Page({ params }: { params: Promise<{ userId: string }> }) {
	const { userId } = await params;
	if (!isUuid(userId)) notFound();
	return <AdminDetailPage module="users" title="Managed user security" permission="security.read" id={userId} />;
}
