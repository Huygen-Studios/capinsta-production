import { AdminModulePage } from "@/components/admin/admin-module-page";
export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  return (
    <AdminModulePage
      module="audit-log"
      title="Audit log"
      description="Searchable, append-only evidence of administrative actions and failures."
      permission="audit.read"
      searchParams={searchParams}
    />
  );
}
