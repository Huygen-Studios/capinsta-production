import { redirect } from "next/navigation";
import { getCurrentAdminContext } from "@/admin/auth";

export default async function AdminEntryPage() {
  const context = await getCurrentAdminContext();
  if (!context) redirect("/admincapinsta11/login");
  redirect(
    context.aal === "aal2"
      ? "/admincapinsta11/overview"
      : "/admincapinsta11/mfa",
  );
}
