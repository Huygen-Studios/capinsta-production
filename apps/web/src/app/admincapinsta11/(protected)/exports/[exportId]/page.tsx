import { AdminDetailPage } from "@/components/admin/admin-detail-page";
export default async function Page({
  params,
}: {
  params: Promise<{ exportId: string }>;
}) {
  const { exportId } = await params;
  return (
    <AdminDetailPage
      module="exports"
      title="Export detail"
      permission="exports.read"
      id={exportId}
    />
  );
}
