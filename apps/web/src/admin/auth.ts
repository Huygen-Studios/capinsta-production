import "server-only";

import { createHash } from "node:crypto";
import { and, eq, gt, inArray } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import {
  adminPermissions,
  adminFreshMfa,
  adminRoleMembers,
  adminRolePermissions,
  adminRoles,
  profiles,
} from "@/db/schema";
import { db } from "@/db";
import { createClient } from "@/lib/supabase/server";
import { isAdminPermission, type AdminPermission } from "./permissions";

export type AdminContext = {
  userId: string;
  email: string | null;
  roleKeys: string[];
  permissions: Set<AdminPermission>;
  sessionId: string | null;
  aal: "aal1" | "aal2";
};

function sessionIdFromToken(token: string | undefined) {
  if (!token) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    );
    if (!parsed || typeof parsed !== "object" || !("session_id" in parsed))
      return null;
    const sessionId = Reflect.get(parsed, "session_id");
    return typeof sessionId === "string" ? sessionId : null;
  } catch {
    return null;
  }
}

export const getCurrentAdminContext = cache(
  async (): Promise<AdminContext | null> => {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) return null;

    const [profile] = await db
      .select({
        accountStatus: profiles.accountStatus,
        adminMfaResetRequired: profiles.adminMfaResetRequired,
      })
      .from(profiles)
      .where(eq(profiles.userId, user.id))
      .limit(1);
    if (!profile || profile.accountStatus !== "active") return null;

    const memberships = await db
      .select({ roleId: adminRoleMembers.roleId, roleKey: adminRoles.key })
      .from(adminRoleMembers)
      .innerJoin(adminRoles, eq(adminRoles.id, adminRoleMembers.roleId))
      .where(
        and(
          eq(adminRoleMembers.userId, user.id),
          eq(adminRoleMembers.active, true),
        ),
      );
    if (memberships.length === 0) return null;

    const permissionRows = await db
      .select({ key: adminPermissions.key })
      .from(adminRolePermissions)
      .innerJoin(
        adminPermissions,
        eq(adminPermissions.id, adminRolePermissions.permissionId),
      )
      .where(
        inArray(
          adminRolePermissions.roleId,
          memberships.map((membership) => membership.roleId),
        ),
      );

    const { data: assurance } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const currentLevel =
      assurance?.currentLevel === "aal2" && !profile.adminMfaResetRequired
        ? "aal2"
        : "aal1";
    return {
      userId: user.id,
      email: user.email ?? null,
      roleKeys: memberships.map((membership) => membership.roleKey),
      permissions: new Set(
        permissionRows.map((row) => row.key).filter(isAdminPermission),
      ),
      sessionId: sessionIdFromToken(session?.access_token),
      aal: currentLevel,
    };
  },
);

export async function requireAdminSession(options?: { allowAal1?: boolean }) {
  const context = await getCurrentAdminContext();
  if (!context) notFound();
  if (!options?.allowAal1 && context.aal !== "aal2") {
    redirect("/admincapinsta11/mfa");
  }
  return context;
}

export async function requireAdminPermission(permission: AdminPermission) {
  const context = await requireAdminSession();
  if (!context.permissions.has(permission)) notFound();
  return context;
}

export async function requireAdminAal2() {
  return requireAdminSession();
}

export class RecentMfaRequiredError extends Error {
  constructor() {
    super("recent_mfa_required");
  }
}

export async function requireRecentMfaForSensitiveAction() {
  const context = await requireAdminSession();
  if (!context.sessionId) throw new RecentMfaRequiredError();
  const [fresh] = await db
    .select({ id: adminFreshMfa.id })
    .from(adminFreshMfa)
    .where(
      and(
        eq(adminFreshMfa.adminUserId, context.userId),
        eq(adminFreshMfa.sessionId, context.sessionId),
        gt(adminFreshMfa.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!fresh) throw new RecentMfaRequiredError();
  return context;
}

export function adminSessionFingerprint(context: AdminContext) {
  return createHash("sha256")
    .update(`${context.userId}:${context.sessionId ?? "no-session"}`)
    .digest("hex");
}
