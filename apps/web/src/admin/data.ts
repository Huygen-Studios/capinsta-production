import "server-only";

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-type-assertion, opencut/prefer-object-params -- Generic Drizzle pagination preserves each query's inferred row shape at runtime. */
import { count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  adminAuditLog,
  adminRoleMembers,
  adminRoles,
  adminSecurityEvents,
  captionJobs,
  exportJobs,
  featureFlags,
  profiles,
  projectRegistry,
  providerHealthEvents,
  supportCases,
} from "@/db/schema";
import { webEnv } from "@/env/web";

export type AdminTableRow = Record<string, string | number | boolean | null>;

export async function getOverviewData() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const sevenDays = new Date(Date.now() - 7 * 86400000);
  const thirtyDays = new Date(Date.now() - 30 * 86400000);
  const [
    [userTotals],
    [captionTotals],
    [exportTotals],
    [projectTotals],
    [supportTotals],
    recentAudit,
    providerHealth,
    backendHealth,
  ] = await Promise.all([
    db
      .select({
        total: count(),
        today: sql<number>`count(*) filter (where ${profiles.createdAt} >= ${today})`,
        seven: sql<number>`count(*) filter (where ${profiles.createdAt} >= ${sevenDays})`,
        thirty: sql<number>`count(*) filter (where ${profiles.createdAt} >= ${thirtyDays})`,
        dau: sql<number>`count(*) filter (where ${profiles.lastSeenAt} >= ${today})`,
        wau: sql<number>`count(*) filter (where ${profiles.lastSeenAt} >= ${sevenDays})`,
        mau: sql<number>`count(*) filter (where ${profiles.lastSeenAt} >= ${thirtyDays})`,
      })
      .from(profiles),
    db
      .select({
        total: count(),
        queued: sql<number>`count(*) filter (where ${captionJobs.status} = 'queued')`,
        running: sql<number>`count(*) filter (where ${captionJobs.status} = 'running')`,
        succeeded: sql<number>`count(*) filter (where ${captionJobs.status} in ('completed','succeeded'))`,
        failed: sql<number>`count(*) filter (where ${captionJobs.status} = 'failed')`,
      })
      .from(captionJobs),
    db
      .select({
        total: count(),
        queued: sql<number>`count(*) filter (where ${exportJobs.status} = 'queued')`,
        running: sql<number>`count(*) filter (where ${exportJobs.status} = 'running')`,
        succeeded: sql<number>`count(*) filter (where ${exportJobs.status} in ('completed','succeeded'))`,
        failed: sql<number>`count(*) filter (where ${exportJobs.status} = 'failed')`,
      })
      .from(exportJobs),
    db
      .select({
        total: count(),
        expiring: sql<number>`count(*) filter (where ${projectRegistry.expiresAt} < now() + interval '24 hours' and ${projectRegistry.retentionHold} = false)`,
        bytes: sql<number>`coalesce(sum(${projectRegistry.approximateBytes}), 0)`,
      })
      .from(projectRegistry),
    db
      .select({
        open: sql<number>`count(*) filter (where ${supportCases.status} not in ('resolved','closed'))`,
      })
      .from(supportCases),
    db
      .select({
        id: adminAuditLog.id,
        action: adminAuditLog.action,
        targetType: adminAuditLog.targetType,
        success: adminAuditLog.success,
        severity: adminAuditLog.severity,
        createdAt: adminAuditLog.createdAt,
      })
      .from(adminAuditLog)
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(8),
    db
      .selectDistinctOn(
        [providerHealthEvents.provider, providerHealthEvents.component],
        {
          provider: providerHealthEvents.provider,
          component: providerHealthEvents.component,
          status: providerHealthEvents.status,
          latencyMs: providerHealthEvents.latencyMs,
          checkedAt: providerHealthEvents.checkedAt,
        },
      )
      .from(providerHealthEvents)
      .orderBy(
        providerHealthEvents.provider,
        providerHealthEvents.component,
        desc(providerHealthEvents.checkedAt),
      ),
    fetch(`${webEnv.BACKEND_INTERNAL_URL}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    })
      .then(async (response) => ({
        ok: response.ok,
        data: response.ok ? await response.json() : null,
      }))
      .catch(() => ({ ok: false, data: null })),
  ]);
  return {
    users: userTotals,
    captions: captionTotals,
    exports: exportTotals,
    projects: projectTotals,
    support: supportTotals,
    recentAudit,
    providerHealth,
    backendHealth,
    refreshedAt: new Date(),
  };
}

const PAGE_SIZE = 30;

export async function getAdminModuleRows({
  module,
  page,
  query,
}: {
  module: string;
  page: number;
  query?: string;
}): Promise<{ rows: AdminTableRow[]; total: number }> {
  const offset = Math.max(0, page - 1) * PAGE_SIZE;
  const search = query?.trim();
  switch (module) {
    case "users": {
      const where = search
        ? or(
            ilike(profiles.emailSnapshot, `%${search}%`),
            sql`${profiles.userId}::text ilike ${`%${search}%`}`,
          )
        : undefined;
      const [rows, [{ total }]] = await Promise.all([
        db
          .select({
            id: profiles.userId,
            email: profiles.emailSnapshot,
            name: profiles.displayName,
            status: profiles.accountStatus,
            created: profiles.createdAt,
            lastSeen: profiles.lastSeenAt,
          })
          .from(profiles)
          .where(where)
          .orderBy(desc(profiles.createdAt))
          .limit(PAGE_SIZE)
          .offset(offset),
        db.select({ total: count() }).from(profiles).where(where),
      ]);
      return { rows: rows.map(serializeRow), total };
    }
    case "caption-jobs":
      return pagedRows(
        db
          .select({
            id: captionJobs.id,
            owner: captionJobs.userId,
            project: captionJobs.projectId,
            status: captionJobs.status,
            provider: captionJobs.provider,
            progress: captionJobs.progress,
            created: captionJobs.createdAt,
          })
          .from(captionJobs),
        captionJobs.createdAt,
        offset,
        db.select({ total: count() }).from(captionJobs),
      );
    case "exports":
      return pagedRows(
        db
          .select({
            id: exportJobs.id,
            owner: exportJobs.userId,
            project: exportJobs.projectId,
            status: exportJobs.status,
            stage: exportJobs.stage,
            progress: exportJobs.progress,
            created: exportJobs.createdAt,
          })
          .from(exportJobs),
        exportJobs.createdAt,
        offset,
        db.select({ total: count() }).from(exportJobs),
      );
    case "projects":
      return pagedRows(
        db
          .select({
            id: projectRegistry.projectId,
            owner: projectRegistry.userId,
            name: projectRegistry.name,
            state: projectRegistry.state,
            expires: projectRegistry.expiresAt,
            retentionHold: projectRegistry.retentionHold,
            updated: projectRegistry.updatedAt,
          })
          .from(projectRegistry),
        projectRegistry.updatedAt,
        offset,
        db.select({ total: count() }).from(projectRegistry),
      );
    case "feedback":
      return pagedRows(
        db
          .select({
            id: supportCases.id,
            email: supportCases.emailSnapshot,
            category: supportCases.category,
            status: supportCases.status,
            priority: supportCases.priority,
            assignee: supportCases.assigneeUserId,
            created: supportCases.createdAt,
          })
          .from(supportCases),
        supportCases.createdAt,
        offset,
        db.select({ total: count() }).from(supportCases),
      );
    case "feature-flags":
      return pagedRows(
        db
          .select({
            id: featureFlags.key,
            description: featureFlags.description,
            enabled: featureFlags.enabled,
            scope: featureFlags.scope,
            version: featureFlags.version,
            updated: featureFlags.updatedAt,
          })
          .from(featureFlags),
        featureFlags.updatedAt,
        offset,
        db.select({ total: count() }).from(featureFlags),
      );
    case "audit-log":
      return pagedRows(
        db
          .select({
            id: adminAuditLog.id,
            admin: adminAuditLog.adminUserId,
            action: adminAuditLog.action,
            target: adminAuditLog.targetId,
            success: adminAuditLog.success,
            severity: adminAuditLog.severity,
            correlation: adminAuditLog.correlationId,
            created: adminAuditLog.createdAt,
          })
          .from(adminAuditLog),
        adminAuditLog.createdAt,
        offset,
        db.select({ total: count() }).from(adminAuditLog),
      );
    case "security": {
      const [events, memberships] = await Promise.all([
        db
          .select({
            id: adminSecurityEvents.id,
            event: adminSecurityEvents.eventType,
            severity: adminSecurityEvents.severity,
            attempts: adminSecurityEvents.attemptCount,
            blockedUntil: adminSecurityEvents.blockedUntil,
            resolved: adminSecurityEvents.resolvedAt,
            created: adminSecurityEvents.createdAt,
          })
          .from(adminSecurityEvents)
          .orderBy(desc(adminSecurityEvents.createdAt))
          .limit(PAGE_SIZE)
          .offset(offset),
        db
          .select({
            id: adminRoleMembers.id,
            user: adminRoleMembers.userId,
            role: adminRoles.name,
            active: adminRoleMembers.active,
            assigned: adminRoleMembers.assignedAt,
          })
          .from(adminRoleMembers)
          .innerJoin(adminRoles, eq(adminRoles.id, adminRoleMembers.roleId))
          .where(eq(adminRoleMembers.active, true)),
      ]);
      return {
        rows: [...memberships, ...events].map(serializeRow),
        total: memberships.length + events.length,
      };
    }
    default:
      return { rows: [], total: 0 };
  }
}

async function pagedRows(
  selectQuery: any,
  orderColumn: any,
  offset: number,
  countQuery: any,
) {
  const [rows, [{ total }]] = await Promise.all([
    selectQuery.orderBy(desc(orderColumn)).limit(PAGE_SIZE).offset(offset),
    countQuery,
  ]);
  return { rows: rows.map(serializeRow), total };
}

function serializeRow(row: Record<string, unknown>): AdminTableRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date
        ? value.toISOString()
        : typeof value === "bigint"
          ? Number(value)
          : (value as AdminTableRow[string]),
    ]),
  );
}

export const ADMIN_PAGE_SIZE = PAGE_SIZE;

export async function getAdminDetail({
  module,
  id,
}: {
  module: string;
  id: string;
}): Promise<AdminTableRow | null> {
  let rows: Record<string, unknown>[] = [];
  switch (module) {
    case "users":
      rows = await db
        .select()
        .from(profiles)
        .where(eq(profiles.userId, id))
        .limit(1);
      break;
    case "security":
      rows = await db
        .select()
        .from(adminSecurityEvents)
        .where(eq(adminSecurityEvents.id, id))
        .limit(1);
      break;
    case "caption-jobs":
      rows = await db
        .select()
        .from(captionJobs)
        .where(eq(captionJobs.id, id))
        .limit(1);
      break;
    case "exports":
      rows = await db
        .select()
        .from(exportJobs)
        .where(eq(exportJobs.id, id))
        .limit(1);
      break;
    case "projects":
      rows = await db
        .select()
        .from(projectRegistry)
        .where(eq(projectRegistry.projectId, id))
        .limit(1);
      break;
    case "feedback":
      rows = await db
        .select()
        .from(supportCases)
        .where(eq(supportCases.id, id))
        .limit(1);
      break;
  }
  return rows[0] ? serializeRow(rows[0]) : null;
}
