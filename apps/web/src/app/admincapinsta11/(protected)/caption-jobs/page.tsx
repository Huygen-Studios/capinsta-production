import { AdminModulePage } from "@/components/admin/admin-module-page";
export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  return (
    <AdminModulePage
      module="caption-jobs"
      title="Caption jobs"
      description="Owned transcription jobs, provider state, retries, timing, and sanitized failures."
      permission="caption_jobs.read"
      searchParams={searchParams}
      detailLinks
    />
  );
}
