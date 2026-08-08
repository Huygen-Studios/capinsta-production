import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  adminAuditLog,
  adminRoleMembers,
  adminRoles,
  profiles,
} from "../src/db/schema";
import { db } from "../src/db";
import { createSupabaseAdminClient } from "../src/lib/supabase/admin";
import { webEnv } from "../src/env/web";

async function main() {
  if (!process.argv.includes("--confirm-initial-super-admin")) {
    throw new Error(
      "Refusing to bootstrap without --confirm-initial-super-admin.",
    );
  }
  const userId = webEnv.CAPINSTA_ADMIN_BOOTSTRAP_USER_ID;
  if (!userId)
    throw new Error("CAPINSTA_ADMIN_BOOTSTRAP_USER_ID is not configured.");
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data.user)
    throw new Error("The configured Supabase user does not exist.");
  const [role] = await db
    .select()
    .from(adminRoles)
    .where(eq(adminRoles.key, "super_admin"))
    .limit(1);
  if (!role) throw new Error("Run database migrations before bootstrapping.");
  const existing = await db
    .select()
    .from(adminRoleMembers)
    .where(eq(adminRoleMembers.userId, userId));
  if (existing.some((membership) => membership.active)) {
    throw new Error("This user already has an active administrative role.");
  }
  await db.transaction(async (tx) => {
    await tx
      .insert(profiles)
      .values({
        userId,
        emailSnapshot: data.user.email,
        displayName:
          typeof data.user.user_metadata?.name === "string"
            ? data.user.user_metadata.name
            : null,
        accountStatus: "active",
      })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: {
          emailSnapshot: data.user.email,
          accountStatus: "active",
          updatedAt: new Date(),
        },
      });
    await tx.insert(adminRoleMembers).values({
      userId,
      roleId: role.id,
      assignedBy: userId,
      reason: "Explicit initial super-admin bootstrap",
    });
    const requestId = randomUUID();
    await tx.insert(adminAuditLog).values({
      adminUserId: userId,
      action: "admin.bootstrap",
      targetType: "user",
      targetId: userId,
      reason: "Explicit initial super-admin bootstrap",
      requestId,
      correlationId: requestId,
      success: true,
      severity: "high",
    });
  });
  console.log(
    "Initial super-admin granted. Remove CAPINSTA_ADMIN_BOOTSTRAP_USER_ID now.",
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Bootstrap failed.");
  process.exitCode = 1;
});
