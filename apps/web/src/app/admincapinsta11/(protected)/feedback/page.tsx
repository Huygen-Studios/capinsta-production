import { AdminModulePage } from "@/components/admin/admin-module-page";
export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  return (
    <AdminModulePage
      module="feedback"
      title="Feedback and support"
      description="Case triage, assignment, private notes, linked resources, and resolution history."
      permission="feedback.read"
      searchParams={searchParams}
      detailLinks
    />
  );
}
