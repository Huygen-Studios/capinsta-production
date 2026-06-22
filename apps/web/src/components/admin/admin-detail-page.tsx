import { notFound } from "next/navigation";
import { requireAdminPermission } from "@/admin/auth";
import { getAdminDetail } from "@/admin/data";
import type { AdminPermission } from "@/admin/permissions";
import { AdminPageHeader } from "./admin-page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AdminMutationPanel } from "./admin-mutation-panel";
import { AdminOperationPanel } from "./admin-operation-panel";
import { AdminUserControls } from "./admin-user-controls";
import { AdminSupportControls } from "./admin-support-controls";
import { AdminProjectControls } from "./admin-project-controls";

export async function AdminDetailPage({
  module,
  title,
  permission,
  id,
}: {
  module: string;
  title: string;
  permission: AdminPermission;
  id: string;
}) {
  const context = await requireAdminPermission(permission);
  const record = await getAdminDetail({ module, id });
  if (!record) notFound();
  return (
    <>
      <AdminPageHeader
        title={title}
        description={`Protected operational record ${id}. Sensitive credentials and raw secrets are never displayed.`}
      />
      <Card className="border-2">
        <CardContent className="grid gap-px bg-border p-px sm:grid-cols-2 xl:grid-cols-3">
          {Object.entries(record).map(([key, value]) => (
            <div key={key} className="min-w-0 bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {humanize(key)}
              </p>
              <div className="mt-2 break-words font-mono text-sm">
                {typeof value === "boolean" ? (
                  <Badge variant="outline">{value ? "Yes" : "No"}</Badge>
                ) : value === null ? (
                  "—"
                ) : (
                  String(value)
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      {module === "users" &&
      record.accountStatus === "active" &&
      context.permissions.has("users.suspend") ? (
        <AdminMutationPanel
          action="user.suspend"
          targetId={id}
          title="Suspend application access"
          description="Immediately denies Capinsta application and admin access. A recent MFA verification and audit reason are required."
          confirmText={id}
        />
      ) : null}
      {module === "users" ? (
        <AdminUserControls
          targetId={id}
          canManageRoles={context.permissions.has("users.manage_roles")}
          canScheduleDelete={context.permissions.has("users.schedule_delete")}
          canManageLimits={context.permissions.has("system.manage_limits")}
          canResetMfa={context.permissions.has("security.reset_admin_mfa")}
          deletionScheduled={Boolean(record.scheduledDeletionAt)}
        />
      ) : null}
      {module === "caption-jobs" ? (
        <AdminOperationPanel
          targetId={id}
          actions={[
            ...(context.permissions.has("caption_jobs.cancel") &&
            !["completed", "failed", "cancelled", "expired", "closed"].includes(
              String(record.status),
            )
              ? [
                  {
                    action: "caption.cancel",
                    label: "Cancel job",
                    destructive: true,
                  },
                ]
              : []),
            ...(context.permissions.has("caption_jobs.cancel") &&
            record.status === "failed"
              ? [{ action: "caption.close", label: "Mark failed job closed" }]
              : []),
            ...(context.permissions.has("caption_jobs.retry") &&
            ["failed", "closed"].includes(String(record.status))
              ? [{ action: "caption.retry", label: "Retry from source" }]
              : []),
          ]}
        />
      ) : null}
      {module === "caption-jobs" &&
      context.permissions.has("caption_jobs.download_diagnostics") ? (
        <a
          className="mt-4 inline-flex text-sm font-semibold text-primary hover:underline"
          href={`/api/admin/diagnostics?jobId=${encodeURIComponent(id)}`}
        >
          Download sanitized diagnostics
        </a>
      ) : null}
      {module === "exports" ? (
        <AdminOperationPanel
          targetId={id}
          actions={[
            ...(context.permissions.has("exports.cancel") &&
            ["queued", "running"].includes(String(record.status))
              ? [
                  {
                    action: "export.cancel",
                    label: "Cancel export",
                    destructive: true,
                  },
                ]
              : []),
            ...(context.permissions.has("exports.retry") &&
            ["failed", "cancelled", "expired"].includes(String(record.status))
              ? [{ action: "export.retry", label: "Retry immutable render" }]
              : []),
            ...(context.permissions.has("exports.delete_output") &&
            Boolean(record.outputExpiry)
              ? [
                  {
                    action: "export.delete_output",
                    label: "Delete output",
                    destructive: true,
                  },
                ]
              : []),
          ]}
        />
      ) : null}
      {module === "projects" &&
      context.permissions.has("projects.extend_retention") ? (
        <AdminProjectControls
          projectId={id}
          retentionHold={Boolean(record.retentionHold)}
        />
      ) : null}
      {module === "projects" &&
      context.permissions.has("projects.delete_temp_assets") ? (
        <AdminOperationPanel
          targetId={id}
          actions={[
            {
              action: "project.cleanup",
              label: "Clean up server assets",
              destructive: true,
            },
          ]}
        />
      ) : null}
      {module === "feedback" && context.permissions.has("feedback.manage") ? (
        <AdminSupportControls caseId={id} />
      ) : null}
      {module === "security" &&
      !record.resolvedAt &&
      context.permissions.has("security.unblock_ip") ? (
        <AdminMutationPanel
          action="security.unblock"
          targetId={id}
          title="Remove temporary security block"
          description="Removes the matching Redis block and resolves the durable security event. A fresh MFA verification and written reason are required."
          confirmText={id}
        />
      ) : null}
      {module === "users" &&
      record.accountStatus === "suspended" &&
      context.permissions.has("users.restore") ? (
        <AdminMutationPanel
          action="user.restore"
          targetId={id}
          title="Restore application access"
          description="Restores the account after a reviewed suspension. The reason and before/after state are audited."
          confirmText={id}
        />
      ) : null}
    </>
  );
}

function humanize(value: string) {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (letter) => letter.toUpperCase());
}
