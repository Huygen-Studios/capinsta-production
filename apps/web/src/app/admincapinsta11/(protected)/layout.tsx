import { requireAdminSession } from "@/admin/auth";
import { AdminShell } from "@/components/admin/admin-shell";
import { getSiteAccessPolicy } from "@/access/server";

export default async function ProtectedAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const context = await requireAdminSession();
  const policy = await getSiteAccessPolicy();
  return <AdminShell context={context} siteMode={policy.mode}>{children}</AdminShell>;
}
