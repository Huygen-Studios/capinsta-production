import { AdminDetailPage } from "@/components/admin/admin-detail-page";
export default async function Page({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  return (
    <AdminDetailPage
      module="feedback"
      title="Support case detail"
      permission="feedback.read"
      id={caseId}
    />
  );
}
