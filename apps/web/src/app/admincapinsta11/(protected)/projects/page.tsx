import { AdminModulePage } from "@/components/admin/admin-module-page";
export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  return (
    <AdminModulePage
      module="projects"
      title="Projects and storage"
      description="Server metadata, temporary assets, output expiry, cleanup, and retention holds."
      permission="projects.read"
      searchParams={searchParams}
      detailLinks
    />
  );
}
