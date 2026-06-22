import { AdminModulePage } from "@/components/admin/admin-module-page";
export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  return (
    <AdminModulePage
      module="security"
      title="Security"
      description="Admin membership, login abuse, temporary blocks, MFA resets, and suspicious events."
      permission="security.read"
      searchParams={searchParams}
      detailLinks
    />
  );
}
