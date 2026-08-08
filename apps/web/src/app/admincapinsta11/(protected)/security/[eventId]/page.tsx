import { AdminDetailPage } from "@/components/admin/admin-detail-page";

export default async function Page({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return (
    <AdminDetailPage
      module="security"
      title="Security event detail"
      permission="security.read"
      id={eventId}
    />
  );
}
