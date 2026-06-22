import { redirect } from "next/navigation";
import { requireAdminSession } from "@/admin/auth";
import { AdminMfaForm } from "@/components/admin/admin-mfa-form";

export default async function AdminMfaPage({
  searchParams,
}: {
  searchParams: Promise<{ step_up?: string }>;
}) {
  const params = await searchParams;
  const context = await requireAdminSession({ allowAal1: true });
  if (context.aal === "aal2" && params.step_up !== "1")
    redirect("/admincapinsta11/overview");
  return <AdminMfaForm />;
}
