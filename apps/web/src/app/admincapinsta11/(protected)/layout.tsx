import { requireAdminSession } from "@/admin/auth";
import { AdminShell } from "@/components/admin/admin-shell";

export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await requireAdminSession();
  return <AdminShell context={context}>{children}</AdminShell>;
}
