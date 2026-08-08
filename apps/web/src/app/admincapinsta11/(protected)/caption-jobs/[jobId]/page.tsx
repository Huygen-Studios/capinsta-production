import { AdminDetailPage } from "@/components/admin/admin-detail-page";
export default async function Page({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  return (
    <AdminDetailPage
      module="caption-jobs"
      title="Caption job detail"
      permission="caption_jobs.read"
      id={jobId}
    />
  );
}
