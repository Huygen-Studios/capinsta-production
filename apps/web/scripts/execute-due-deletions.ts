import { randomUUID } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import { db } from "../src/db";
import { adminAuditLog, profiles } from "../src/db/schema";
import { webEnv } from "../src/env/web";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";

const due = await db
  .select()
  .from(profiles)
  .where(
    and(
      eq(profiles.accountStatus, "deletion_scheduled"),
      lte(profiles.scheduledDeletionAt, new Date()),
    ),
  );
const supabase = createSupabaseAdminClient();
for (const profile of due) {
  const requestId = randomUUID();
  try {
    const cleanup = await fetch(
      `${webEnv.BACKEND_INTERNAL_URL}/api/internal/admin/users/${profile.userId}/execute-deletion`,
      {
        method: "POST",
        headers: {
          "x-capinsta-maintenance-secret": webEnv.INTERNAL_MAINTENANCE_SECRET,
        },
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!cleanup.ok) throw new Error(`backend_cleanup_${cleanup.status}`);
    const { error } = await supabase.auth.admin.deleteUser(profile.userId);
    if (error) throw error;
    await db.transaction(async (tx) => {
      await tx
        .update(profiles)
        .set({
          accountStatus: "deleted",
          emailSnapshot: null,
          displayName: null,
          suspensionReason: null,
          scheduledDeletionAt: null,
          updatedAt: new Date(),
        })
        .where(eq(profiles.userId, profile.userId));
      await tx.insert(adminAuditLog).values({
        action: "user.delete.execute",
        targetType: "user",
        targetId: profile.userId,
        reason: "Scheduled deletion grace period elapsed",
        requestId,
        correlationId: requestId,
        success: true,
        severity: "high",
      });
    });
    console.log(`Deleted scheduled user ${profile.userId}`);
  } catch (error) {
    await db.insert(adminAuditLog).values({
      action: "user.delete.execute",
      targetType: "user",
      targetId: profile.userId,
      reason: "Scheduled deletion grace period elapsed",
      requestId,
      correlationId: requestId,
      success: false,
      failureCode:
        error instanceof Error ? error.message.slice(0, 80) : "deletion_failed",
      severity: "high",
    });
    console.error(`Failed scheduled deletion for ${profile.userId}`);
  }
}
