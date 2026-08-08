import { AdminModulePage } from "@/components/admin/admin-module-page";
export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; sort?: string }>;
}) {
  return (
    <AdminModulePage
      module="exports"
      title="Export operations"
      description="Render queue, stages, output lifetime, retries, and failure classification."
      permission="exports.read"
      searchParams={searchParams}
      detailLinks
    />
  );
}
