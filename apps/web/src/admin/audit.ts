import "server-only";

import { adminAuditLog } from "@/db/schema";
import { db } from "@/db";
import type { AdminContext } from "./auth";
import { adminSessionFingerprint } from "./auth";
import { getAdminRequestMetadata } from "./request";

export async function recordAdminAuditEvent({
  context,
  action,
  targetType,
  targetId,
  reason,
  beforeValue,
  afterValue,
  success,
  failureCode,
  severity = "info",
}: {
  context: AdminContext | null;
  action: string;
  targetType?: string;
  targetId?: string;
  reason?: string;
  beforeValue?: unknown;
  afterValue?: unknown;
  success: boolean;
  failureCode?: string;
  severity?: string;
}) {
  const request = await getAdminRequestMetadata();
  await db.insert(adminAuditLog).values({
    adminUserId: context?.userId,
    action,
    targetType,
    targetId,
    reason,
    beforeValue,
    afterValue,
    requestId: request.requestId,
    correlationId: request.correlationId,
    sessionFingerprint: context ? adminSessionFingerprint(context) : null,
    ipRepresentation: request.ipHash.slice(0, 24),
    userAgentSummary: request.userAgent.slice(0, 120),
    success,
    failureCode,
    severity,
  });
  return request.correlationId;
}
