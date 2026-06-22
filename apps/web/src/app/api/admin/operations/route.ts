import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { recordAdminAuditEvent } from "@/admin/audit";
import {
  requireAdminPermission,
  requireRecentMfaForSensitiveAction,
  RecentMfaRequiredError,
  type AdminContext,
} from "@/admin/auth";
import { adminBackendFetch } from "@/admin/backend";
import type { AdminPermission } from "@/admin/permissions";
import { webEnv } from "@/env/web";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["caption.cancel", "caption.retry", "caption.close"]),
    targetId: z.string().min(1).max(200),
    reason: z.string().trim().min(8).max(1000),
  }),
  z.object({
    action: z.enum(["export.cancel", "export.retry", "export.delete_output"]),
    targetId: z.string().min(1).max(200),
    reason: z.string().trim().min(8).max(1000),
  }),
  z.object({
    action: z.literal("operations.reconcile"),
    targetId: z.literal("runtime"),
    reason: z.string().trim().min(8).max(1000),
  }),
  z.object({
    action: z.literal("project.cleanup"),
    targetId: z.string().min(1).max(200),
    reason: z.string().trim().min(8).max(1000),
  }),
]);

const operationMap: Record<
  z.infer<typeof schema>["action"],
  { permission: AdminPermission; path: (id: string) => string }
> = {
  "caption.cancel": {
    permission: "caption_jobs.cancel",
    path: (id) => `/api/admin/jobs/${encodeURIComponent(id)}/cancel`,
  },
  "caption.retry": {
    permission: "caption_jobs.retry",
    path: (id) => `/api/admin/jobs/${encodeURIComponent(id)}/retry`,
  },
  "caption.close": {
    permission: "caption_jobs.cancel",
    path: (id) => `/api/admin/jobs/${encodeURIComponent(id)}/close`,
  },
  "export.cancel": {
    permission: "exports.cancel",
    path: (id) => `/api/admin/exports/${encodeURIComponent(id)}/cancel`,
  },
  "export.retry": {
    permission: "exports.retry",
    path: (id) => `/api/admin/exports/${encodeURIComponent(id)}/retry`,
  },
  "export.delete_output": {
    permission: "exports.delete_output",
    path: (id) => `/api/admin/exports/${encodeURIComponent(id)}/delete-output`,
  },
  "operations.reconcile": {
    permission: "system.manage_providers",
    path: () => "/api/admin/reconcile",
  },
  "project.cleanup": {
    permission: "projects.delete_temp_assets",
    path: (id) => `/api/admin/projects/${encodeURIComponent(id)}/cleanup`,
  },
};

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== webEnv.NEXT_PUBLIC_SITE_URL) {
    return NextResponse.json(
      { error: "Invalid request origin." },
      { status: 403 },
    );
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const value = parsed.data;
  const operation = operationMap[value.action];
  let context: AdminContext | undefined;
  try {
    context = await requireAdminPermission(operation.permission);
    await requireRecentMfaForSensitiveAction();
    const response = await adminBackendFetch({
      path: operation.path(value.targetId),
      permission: operation.permission,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key":
            request.headers.get("idempotency-key") ?? randomUUID(),
        },
        body: JSON.stringify({ reason: value.reason }),
      },
    });
    const result: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`backend_${response.status}`);
    const correlationId = await recordAdminAuditEvent({
      context,
      action: value.action,
      targetType: value.action.split(".")[0],
      targetId: value.targetId,
      reason: value.reason,
      afterValue: result,
      success: true,
      severity: "high",
    });
    return NextResponse.json({ ok: true, correlationId, result });
  } catch (error) {
    if (error instanceof RecentMfaRequiredError) {
      return NextResponse.json(
        {
          error: "A fresh MFA verification is required.",
          stepUp: "/admincapinsta11/mfa?step_up=1",
        },
        { status: 428 },
      );
    }
    await recordAdminAuditEvent({
      context: context ?? null,
      action: value.action,
      targetType: value.action.split(".")[0],
      targetId: value.targetId,
      reason: value.reason,
      success: false,
      failureCode: error instanceof Error ? error.message : "operation_failed",
      severity: "high",
    });
    return NextResponse.json(
      { error: "The operation could not be completed." },
      { status: 400 },
    );
  }
}
