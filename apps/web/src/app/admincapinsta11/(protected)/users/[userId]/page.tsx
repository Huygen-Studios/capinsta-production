import { AdminDetailPage } from "@/components/admin/admin-detail-page";
export default async function Page({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  return (
    <AdminDetailPage
      module="users"
      title="User detail"
      permission="users.read"
      id={userId}
    />
  );
}
