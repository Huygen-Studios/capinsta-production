import "server-only";

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-type-assertion, opencut/prefer-object-params -- Generic Drizzle pagination preserves each query's inferred row shape at runtime. */
import { asc, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  adminAuditLog,
  adminRoleMembers,
  adminRoles,
  adminSecurityEvents,
  captionJobs,
  deletedProjectRecords,
  exportJobs,
  featureFlags,
  profiles,
  productEvents,
  projectRegistry,
  providerHealthEvents,
  supportCases,
} from "@/db/schema";
import { webEnv } from "@/env/web";
import { querySupabaseAuthUserMetrics } from "./auth-metrics";

export type AdminTableRow = Record<string, string | number | boolean | null>;
type RecentActivityRow = { id: string; type: string; actor: string | null; status: string; createdAt: Date | null; target: string | null };

async function overviewQuery<T>({
  source,
  query,
  fallback,
}: {
  source: string;
  query: Promise<T>;
  fallback: T;
}): Promise<{ data: T; degradedSource: string | null }> {
  try {
    return { data: await query, degradedSource: null };
  } catch (error) {
    console.error("admin_overview_query_failed", {
      source,
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              cause:
                error.cause instanceof Error
                  ? {
                      name: error.cause.name,
                      message: error.cause.message,
                    }
                  : undefined,
            }
          : { name: "UnknownError", message: "Unknown overview query failure" },
    });
    return { data: fallback, degradedSource: source };
  }
}

export async function getOverviewData() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const sevenDays = new Date(Date.now() - 7 * 86400000);
  const thirtyDays = new Date(Date.now() - 30 * 86400000);
  const [
    usersResult,
    captionsResult,
    exportsResult,
    projectsResult,
    supportResult,
    auditResult,
    providerResult,
    backendResult,
  ] = await Promise.all([
    overviewQuery<{
      total: number | null;
      today: number | null;
      seven: number | null;
      thirty: number | null;
      dau: number | null;
      wau: number | null;
      mau: number | null;
    }>({
      source: "auth_users",
      query: Promise.all([
        querySupabaseAuthUserMetrics({ startUtc: thirtyDays.toISOString(), endUtc: new Date().toISOString() }),
        db.execute(sql`select
          count(*) filter (where last_seen_at >= ${today})::int as dau,
          count(*) filter (where last_seen_at >= ${sevenDays})::int as wau,
          count(*) filter (where last_seen_at >= ${thirtyDays})::int as mau
          from profiles`),
      ]).then(([auth, activity]) => {
        const daily = auth.dailyNewUsers;
        const countSince = (date: Date) => daily.filter((item) => Date.parse(item.date + "T00:00:00.000Z") >= date.getTime()).reduce((sum, item) => sum + item.value, 0);
        const row = activity[0] as { dau: number; wau: number; mau: number };
        return { total: auth.total, today: countSince(today), seven: countSince(sevenDays), thirty: auth.newInRange, ...row };
      }),
      fallback: {
        total: null,
        today: null,
        seven: null,
        thirty: null,
        dau: null,
        wau: null,
        mau: null,
      },
    }),
    overviewQuery({
      source: "caption_jobs",
      query: db
        .select({
          total: count(),
          queued: sql<number>`count(*) filter (where ${captionJobs.status} = 'queued')`,
          running: sql<number>`count(*) filter (where ${captionJobs.status} = 'running')`,
          succeeded: sql<number>`count(*) filter (where ${captionJobs.status} in ('completed','succeeded'))`,
          failed: sql<number>`count(*) filter (where ${captionJobs.status} = 'failed')`,
        })
        .from(captionJobs)
        .then((rows) => rows[0]),
      fallback: { total: 0, queued: 0, running: 0, succeeded: 0, failed: 0 },
    }),
    overviewQuery({
      source: "export_jobs",
      query: db
        .select({
          total: count(),
          queued: sql<number>`count(*) filter (where ${exportJobs.status} = 'queued')`,
          running: sql<number>`count(*) filter (where ${exportJobs.status} = 'running')`,
          succeeded: sql<number>`count(*) filter (where ${exportJobs.status} in ('completed','succeeded'))`,
          failed: sql<number>`count(*) filter (where ${exportJobs.status} = 'failed')`,
        })
        .from(exportJobs)
        .then((rows) => rows[0]),
      fallback: { total: 0, queued: 0, running: 0, succeeded: 0, failed: 0 },
    }),
    overviewQuery({
      source: "projects",
      query: db
        .select({
          total: count(),
          expiring: sql<number>`count(*) filter (where ${projectRegistry.expiresAt} < now() + interval '24 hours' and ${projectRegistry.retentionHold} = false)`,
          bytes: sql<number>`coalesce(sum(${projectRegistry.approximateBytes}), 0)`,
        })
        .from(projectRegistry)
        .then((rows) => rows[0]),
      fallback: { total: 0, expiring: 0, bytes: 0 },
    }),
    overviewQuery({
      source: "support_cases",
      query: db
        .select({
          open: sql<number>`count(*) filter (where ${supportCases.status} not in ('resolved','closed'))`,
        })
        .from(supportCases)
        .then((rows) => rows[0]),
      fallback: { open: 0 },
    }),
    overviewQuery({
      source: "admin_audit_log",
      query: db
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
      fallback: [],
    }),
    overviewQuery({
      source: "provider_health_events",
      query: db
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
      fallback: [],
    }),
    overviewQuery({
      source: "backend_health",
      query: fetch(`${webEnv.BACKEND_INTERNAL_URL}/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(2500),
      }).then(async (response) => ({
        ok: response.ok,
        data: response.ok ? await response.json() : null,
      })),
      fallback: { ok: false, data: null },
    }),
  ]);
  const degradedSources = [
    usersResult,
    captionsResult,
    exportsResult,
    projectsResult,
    supportResult,
    auditResult,
    providerResult,
    backendResult,
  ].flatMap((result) =>
    result.degradedSource ? [result.degradedSource] : [],
  );
  const activitySettled = await Promise.allSettled([
    db.select({ id: productEvents.id, type: productEvents.eventName, actor: productEvents.userId, status: sql<string>`coalesce(${productEvents.metadata}->>'status', 'recorded')`, createdAt: productEvents.occurredAt, target: sql<string>`coalesce(${productEvents.projectId}, ${productEvents.captionJobId}, ${productEvents.exportJobId})` }).from(productEvents).orderBy(desc(productEvents.occurredAt)).limit(15),
    db.select({ id: profiles.userId, type: sql<string>`'new_account'`, actor: profiles.emailSnapshot, status: sql<string>`'created'`, createdAt: profiles.createdAt, target: profiles.userId }).from(profiles).orderBy(desc(profiles.createdAt)).limit(8),
    db.select({ id: projectRegistry.projectId, type: sql<string>`'project_created'`, actor: projectRegistry.userId, status: projectRegistry.state, createdAt: projectRegistry.createdAt, target: projectRegistry.projectId }).from(projectRegistry).orderBy(desc(projectRegistry.createdAt)).limit(8),
	 db.select({ id: captionJobs.id, type: sql<string>`case when ${captionJobs.status} = 'failed' then 'caption_failed' else 'caption_completed' end`, actor: captionJobs.userId, status: captionJobs.status, createdAt: captionJobs.completedAt, target: captionJobs.id }).from(captionJobs).where(sql`${captionJobs.completedAt} is not null and ${captionJobs.status} in ('failed','completed','succeeded')`).orderBy(desc(captionJobs.completedAt)).limit(8),
	 db.select({ id: exportJobs.id, type: sql<string>`case when ${exportJobs.status} = 'failed' then 'export_failed' else 'export_completed' end`, actor: exportJobs.userId, status: exportJobs.status, createdAt: exportJobs.completedAt, target: exportJobs.id }).from(exportJobs).where(sql`${exportJobs.completedAt} is not null and ${exportJobs.status} in ('failed','completed','succeeded')`).orderBy(desc(exportJobs.completedAt)).limit(8),
    db.select({ id: adminAuditLog.id, type: adminAuditLog.action, actor: adminAuditLog.adminUserId, status: sql<string>`case when ${adminAuditLog.success} then 'success' else 'failed' end`, createdAt: adminAuditLog.createdAt, target: adminAuditLog.targetId }).from(adminAuditLog).orderBy(desc(adminAuditLog.createdAt)).limit(8),
  ]);
	const activityRows: RecentActivityRow[] = [];
	for (const result of activitySettled) {
		if (result.status !== "fulfilled") continue;
		for (const item of result.value) activityRows.push({ ...item, target: item.target ?? null });
	}
  const recentActivity = activityRows
	.filter((item): item is RecentActivityRow & { createdAt: Date } => item.createdAt instanceof Date)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()).slice(0, 20)
	.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() }));
  return {
    users: usersResult.data,
    captions: captionsResult.data,
    exports: exportsResult.data,
    projects: projectsResult.data,
    support: supportResult.data,
    recentAudit: auditResult.data,
    providerHealth: providerResult.data,
    backendHealth: backendResult.data,
    degradedSources,
    refreshedAt: new Date(),
    recentActivity,
  };
}

const PAGE_SIZE = 30;

export async function getAdminModuleRows({
  module,
  page,
  query,
  sort = "newest",
}: {
  module: string;
  page: number;
  query?: string;
  sort?: string;
}): Promise<{ rows: AdminTableRow[]; total: number; selectableUserIds?: string[] }> {
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
      const [rows, [{ total }], selectable] = await Promise.all([
        db
          .select({
            id: profiles.userId,
            email: profiles.emailSnapshot,
            name: profiles.displayName,
            status: profiles.accountStatus,
            productAccess: profiles.productAccessStatus,
            accessExpires: profiles.productAccessExpiresAt,
            authProvider: profiles.authProviderSnapshot,
            emailVerified: sql<boolean>`${profiles.emailConfirmedAt} is not null`,
            lastSignIn: profiles.lastSignInAt,
            admin: sql<boolean>`exists (
              select 1 from admin_role_members arm
              where arm.user_id = ${profiles.userId} and arm.active = true
            )`,
            productRole: sql<string | null>`(
              select ar.key from app_role_members arm
              join app_roles ar on ar.id = arm.role_id
              where arm.user_id = ${profiles.userId}
                and arm.active = true
                and (arm.expires_at is null or arm.expires_at > now())
              order by ar.key desc
              limit 1
            )`,
            created: profiles.createdAt,
            lastSeen: profiles.lastSeenAt,
          })
          .from(profiles)
          .where(where)
          .orderBy(desc(profiles.createdAt))
          .limit(PAGE_SIZE)
          .offset(offset),
        db.select({ total: count() }).from(profiles).where(where),
        db
          .select({ id: profiles.userId })
          .from(profiles)
          .where(
            where
              ? sql`(${where}) and ${profiles.accountStatus} = 'active'`
              : eq(profiles.accountStatus, "active"),
          )
          .orderBy(
            sort === "oldest" ? asc(profiles.createdAt) :
            sort === "email" ? asc(profiles.emailSnapshot) :
            sort === "access_status" ? asc(profiles.productAccessStatus) :
            sort === "last_activity" ? desc(profiles.lastSeenAt) : desc(profiles.createdAt),
          )
          .limit(250),
      ]);
      return {
        rows: rows.map(serializeRow),
        total,
        selectableUserIds: selectable.map((row) => row.id),
      };
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
        sort === "oldest" ? asc(captionJobs.createdAt) :
        sort === "running_first" ? sql`${captionJobs.status} = 'running' desc, ${captionJobs.createdAt} desc` :
        sort === "failed_first" ? sql`${captionJobs.status} = 'failed' desc, ${captionJobs.createdAt} desc` :
        sort === "longest_duration" ? sql`${captionJobs.completedAt} - ${captionJobs.startedAt} desc nulls last` :
        sort === "shortest_duration" ? sql`${captionJobs.completedAt} - ${captionJobs.startedAt} asc nulls last` : desc(captionJobs.createdAt),
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
        sort === "oldest" ? asc(exportJobs.createdAt) :
        sort === "queued_first" ? sql`${exportJobs.status} = 'queued' desc, ${exportJobs.createdAt} desc` :
        sort === "failed_first" ? sql`${exportJobs.status} = 'failed' desc, ${exportJobs.createdAt} desc` :
        sort === "longest_duration" ? sql`${exportJobs.completedAt} - ${exportJobs.startedAt} desc nulls last` :
        sort === "shortest_duration" ? sql`${exportJobs.completedAt} - ${exportJobs.startedAt} asc nulls last` : desc(exportJobs.createdAt),
        offset,
        db.select({ total: count() }).from(exportJobs),
      );
    case "projects":
      {
        const [active, deleted, activeCount, deletedCount] = await Promise.all([
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
          .from(projectRegistry)
          .orderBy(
            sort === "oldest" ? asc(projectRegistry.createdAt) :
            sort === "nearing_expiry" ? asc(projectRegistry.expiresAt) :
            sort === "owner" ? asc(projectRegistry.userId) : desc(projectRegistry.updatedAt),
          )
          .limit(PAGE_SIZE)
          .offset(offset),
          db
            .select({
              id: deletedProjectRecords.projectId,
              owner: deletedProjectRecords.ownerId,
              name: sql<string>`'Deleted project'`,
              state: sql<string>`'deleted'`,
              expires: sql<Date | null>`null`,
              retentionHold: sql<boolean>`false`,
              updated: deletedProjectRecords.deletedAt,
            })
            .from(deletedProjectRecords)
            .orderBy(sort === "oldest" ? asc(deletedProjectRecords.deletedAt) : desc(deletedProjectRecords.deletedAt))
            .limit(PAGE_SIZE)
            .offset(offset),
          db.select({ total: count() }).from(projectRegistry),
          db.select({ total: count() }).from(deletedProjectRecords),
        ]);
        const rows = [...active, ...deleted]
          .toSorted(
            (left, right) =>
              new Date(right.updated).getTime() - new Date(left.updated).getTime(),
          )
          .slice(0, PAGE_SIZE);
        return {
          rows: rows.map(serializeRow),
          total: Number(activeCount[0]?.total ?? 0) + Number(deletedCount[0]?.total ?? 0),
        };
      }
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
        desc(supportCases.createdAt),
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
        desc(featureFlags.updatedAt),
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
        desc(adminAuditLog.createdAt),
        offset,
        db.select({ total: count() }).from(adminAuditLog),
      );
    case "security": {
      const [events, memberships] = await Promise.all([
        db
          .select({
            id: adminSecurityEvents.id,
            recordType: sql<string>`'event'`,
            event: adminSecurityEvents.eventType,
            severity: adminSecurityEvents.severity,
            attempts: adminSecurityEvents.attemptCount,
            blockedUntil: adminSecurityEvents.blockedUntil,
            resolved: adminSecurityEvents.resolvedAt,
            created: adminSecurityEvents.createdAt,
          })
          .from(adminSecurityEvents)
          .orderBy(
            sort === "oldest" ? asc(adminSecurityEvents.createdAt) :
            sort === "severity" ? desc(adminSecurityEvents.severity) :
            sort === "unresolved" ? asc(adminSecurityEvents.resolvedAt) : desc(adminSecurityEvents.createdAt),
          )
          .limit(PAGE_SIZE)
          .offset(offset),
        db
          .select({
            id: adminRoleMembers.id,
            recordType: sql<string>`'user'`,
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
  orderExpression: any,
  offset: number,
  countQuery: any,
) {
  const [rows, [{ total }]] = await Promise.all([
    selectQuery.orderBy(orderExpression).limit(PAGE_SIZE).offset(offset),
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
        .select({
          userId: profiles.userId,
          emailSnapshot: profiles.emailSnapshot,
          displayName: profiles.displayName,
          accountStatus: profiles.accountStatus,
          productAccessStatus: profiles.productAccessStatus,
          productAccessExpiresAt: profiles.productAccessExpiresAt,
          effectiveAdmin: sql<boolean>`exists (
            select 1
            from admin_role_members arm
            where arm.user_id = ${profiles.userId}
              and arm.active = true
          )`,
          effectiveAdminRoles: sql<string | null>`(
            select string_agg(ar.key, ', ' order by ar.key)
            from admin_role_members arm
            join admin_roles ar on ar.id = arm.role_id
            where arm.user_id = ${profiles.userId}
              and arm.active = true
          )`,
          effectiveProductRoles: sql<string | null>`(
            select string_agg(ar.key, ', ' order by ar.key)
            from app_role_members arm
            join app_roles ar on ar.id = arm.role_id
            where arm.user_id = ${profiles.userId}
              and arm.active = true
              and (arm.expires_at is null or arm.expires_at > now())
          )`,
          roleAccessSource: sql<string>`'admin_role_members/app_role_members'`,
          authProviderSnapshot: profiles.authProviderSnapshot,
          emailConfirmedAt: profiles.emailConfirmedAt,
          lastSignInAt: profiles.lastSignInAt,
          productAccessApprovedAt: profiles.productAccessApprovedAt,
          productAccessUpdatedAt: profiles.productAccessUpdatedAt,
          productAccessUpdatedBy: profiles.productAccessUpdatedBy,
          productAccessReason: profiles.productAccessReason,
          scheduledDeletionAt: profiles.scheduledDeletionAt,
          createdAt: profiles.createdAt,
          updatedAt: profiles.updatedAt,
          lastSeenAt: profiles.lastSeenAt,
		  projects: sql<number>`(select count(*)::int from project_registry pr where pr.user_id = ${profiles.userId})`,
		  recentCaptions: sql<string>`coalesce((select string_agg(cj.id || ':' || cj.status, ', ' order by cj.created_at desc) from (select id, status, created_at from caption_jobs where user_id = ${profiles.userId} order by created_at desc limit 5) cj), '')`,
		  recentExports: sql<string>`coalesce((select string_agg(ej.id || ':' || ej.status, ', ' order by ej.created_at desc) from (select id, status, created_at from export_jobs where user_id = ${profiles.userId} order by created_at desc limit 5) ej), '')`,
		  recentAuditEvents: sql<string>`coalesce((select string_agg(a.action, ', ' order by a.created_at desc) from (select action, created_at from admin_audit_log where target_id = ${profiles.userId}::text order by created_at desc limit 5) a), '')`,
		  currentLaunchMode: sql<string>`coalesce((select mode from site_access_policy where id = 'global'), 'public')`,
        })
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
      if (rows.length === 0) {
        rows = await db
          .select({
            projectId: deletedProjectRecords.projectId,
            ownerId: deletedProjectRecords.ownerId,
            state: sql<string>`'deleted'`,
            deletedAt: deletedProjectRecords.deletedAt,
            sourceDurationSeconds: deletedProjectRecords.sourceDurationSeconds,
            sourceSizeBytes: deletedProjectRecords.sourceSizeBytes,
            captionLanguage: deletedProjectRecords.captionLanguage,
            captionWordCount: deletedProjectRecords.captionWordCount,
            captionChunkCount: deletedProjectRecords.captionChunkCount,
            captionModel: deletedProjectRecords.captionModel,
            generationStatus: deletedProjectRecords.generationStatus,
            generationProcessingSeconds:
              deletedProjectRecords.generationProcessingSeconds,
            exportAttemptCount: deletedProjectRecords.exportAttemptCount,
            exportFormat: deletedProjectRecords.exportFormat,
            exportWidth: deletedProjectRecords.exportWidth,
            exportHeight: deletedProjectRecords.exportHeight,
            exportFps: deletedProjectRecords.exportFps,
            exportDurationSeconds: deletedProjectRecords.exportDurationSeconds,
            exportOutputSizeBytes: deletedProjectRecords.exportOutputSizeBytes,
            exportProcessingSeconds:
              deletedProjectRecords.exportProcessingSeconds,
            exportStatus: deletedProjectRecords.exportStatus,
            normalizedErrorCode: deletedProjectRecords.normalizedErrorCode,
            deletionStatus: deletedProjectRecords.deletionStatus,
          })
          .from(deletedProjectRecords)
          .where(eq(deletedProjectRecords.projectId, id))
          .limit(1);
      }
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
