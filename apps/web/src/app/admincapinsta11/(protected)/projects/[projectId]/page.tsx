import { AdminDetailPage } from "@/components/admin/admin-detail-page";
export default async function Page({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <AdminDetailPage
      module="projects"
      title="Project detail"
      permission="projects.read"
      id={projectId}
    />
  );
}
