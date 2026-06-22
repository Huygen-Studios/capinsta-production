import { AdminModulePage } from "@/components/admin/admin-module-page";
export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  return (
    <AdminModulePage
      module="users"
      title="Users"
      description="Accounts, access state, usage ownership, and administrative membership."
      permission="users.read"
      searchParams={searchParams}
      detailLinks
    />
  );
}
