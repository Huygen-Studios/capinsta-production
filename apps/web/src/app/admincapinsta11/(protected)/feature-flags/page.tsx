import { requireAdminPermission } from "@/admin/auth";
import { getRuntimeConfiguration } from "@/admin/runtime-config";
import { AdminFeatureControls } from "@/components/admin/admin-feature-controls";
import { AdminPageHeader } from "@/components/admin/admin-page-header";

export default async function Page() {
  await requireAdminPermission("feature_flags.read");
  const configuration = await getRuntimeConfiguration();
  return (
    <>
      <AdminPageHeader
        title="Feature flags and limits"
        description="Effective production controls with validation, version history, fresh-MFA enforcement, and audit evidence."
      />
      <AdminFeatureControls
        flags={Object.values(configuration.flags)}
        settings={Object.values(configuration.settings)}
      />
    </>
  );
}
