import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { invalidateSiteAccessPolicy } from "@/access/server";
import { recordAdminAuditEvent } from "@/admin/audit";
import { adminBackendFetch } from "@/admin/backend";
import {
	getAdminTranscriptionConfiguration,
	transcriptionPipelineOptionsColumnExists,
} from "@/admin/transcription-config-db";
import {
	requireAdminPermission,
	requireRecentMfaForSensitiveAction,
	RecentMfaRequiredError,
	type AdminContext,
} from "@/admin/auth";
import {
	checkAdminApiRateLimit,
	clearAdminSecurityBlock,
} from "@/admin/rate-limit";
import { getAdminRequestMetadata } from "@/admin/request";
import { db } from "@/db";
import {
	adminRoleMembers,
	adminRoles,
	adminSecurityEvents,
	appPermissions,
	appRoleMembers,
	appRoles,
	appUserPermissionOverrides,
	featureFlags,
	featureFlagVersions,
	profiles,
	projectRegistry,
	supportCaseEvents,
	supportCases,
	siteAccessPolicy,
	systemSettings,
	transcriptionConfigurationVersions,
	transcriptionConfigurations,
	userQuotas,
} from "@/db/schema";
import { webEnv } from "@/env/web";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
	DEFAULT_PIPELINE_OPTIONS,
	defaultProviderOptions,
	getTranscriptionCatalogEntry,
	mergePipelineOptions,
} from "@/transcription/provider-catalog";

const reason = z.string().trim().min(8).max(1000);
const pipelineOptions = z.record(z.string(), z.unknown()).optional();
const appRoleKey = z.enum(["member", "developer"]);
const appPermissionKey = z.enum([
	"app.access",
	"projects.access",
	"editor.access",
	"exports.access",
	"render.access",
	"internal.diagnostics.access",
	"maintenance.bypass",
]);
const expiration = z
	.string()
	.datetime()
	.nullable()
	.optional()
	.transform((value) => (value ? new Date(value) : null));
const roleKey = z.enum([
	"super_admin",
	"operations",
	"support",
	"analyst",
	"content_manager",
]);
const quotaSchema = z.object({
	dailyCaptionMinutes: z.number().int().min(0).max(100000),
	dailyExportMinutes: z.number().int().min(0).max(100000),
	maxUploadDurationSeconds: z.number().int().min(1).max(86400),
	maxConcurrentCaptionJobs: z.number().int().min(1).max(100),
	maxConcurrentExportJobs: z.number().int().min(1).max(100),
});
const transcriptionProvider = z.enum(["gemini", "openai", "sarvam"]);
const transcriptionProviderOptions = z.record(z.string(), z.unknown()).optional();

const schema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("user.suspend"), targetId: z.uuid(), reason }),
	z.object({ action: z.literal("user.restore"), targetId: z.uuid(), reason }),
	z.object({
		action: z.literal("user.sessions.revoke"),
		targetId: z.uuid(),
		reason,
	}),
	z.object({
		action: z.literal("user.delete.schedule"),
		targetId: z.uuid(),
		reason,
		graceDays: z.number().int().min(7).max(90),
	}),
	z.object({
		action: z.literal("user.delete.cancel"),
		targetId: z.uuid(),
		reason,
	}),
	z.object({
		action: z.literal("admin.role.assign"),
		targetId: z.uuid(),
		role: roleKey,
		reason,
	}),
	z.object({
		action: z.literal("admin.role.revoke"),
		targetId: z.uuid(),
		role: roleKey,
		reason,
	}),
	z.object({
		action: z.literal("admin.mfa.reset"),
		targetId: z.uuid(),
		reason,
	}),
	z.object({
		action: z.literal("quota.update"),
		targetId: z.uuid(),
		quotas: quotaSchema,
		reason,
	}),
	z.object({
		action: z.literal("feature_flag.update"),
		targetId: z.string().min(1).max(120),
		enabled: z.boolean(),
		configuration: z.record(z.string(), z.unknown()).optional(),
		reason,
	}),
	z.object({
		action: z.literal("feature_flag.rollback"),
		targetId: z.string().min(1).max(120),
		version: z.number().int().min(1),
		reason,
	}),
	z.object({
		action: z.literal("security.unblock"),
		targetId: z.uuid(),
		reason,
	}),
	z.object({
		action: z.literal("project.retention"),
		targetId: z.string().min(1).max(200),
		mode: z.enum(["extend", "hold", "release"]),
		days: z.number().int().min(1).max(365).optional(),
		reason,
	}),
	z.object({
		action: z.literal("support.update"),
		targetId: z.string().min(1).max(200),
		status: z
			.enum(["new", "investigating", "waiting_for_user", "resolved", "closed"])
			.optional(),
		priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
		category: z.string().trim().min(1).max(80).optional(),
		assigneeUserId: z.uuid().nullable().optional(),
		userId: z.uuid().nullable().optional(),
		projectId: z.string().max(200).nullable().optional(),
		captionJobId: z.string().max(200).nullable().optional(),
		exportJobId: z.string().max(200).nullable().optional(),
		resolution: z.string().max(4000).nullable().optional(),
		reason,
	}),
	z.object({
		action: z.literal("support.note"),
		targetId: z.string().min(1).max(200),
		note: z.string().trim().min(1).max(4000),
		reason,
	}),
	z.object({
		action: z.literal("setting.update"),
		targetId: z.enum([
			"maximum_upload_duration_seconds",
			"daily_caption_minutes",
			"daily_export_minutes",
			"maximum_concurrent_caption_jobs",
			"maximum_concurrent_export_jobs",
			"global_export_concurrency",
			"project_retention_days",
		]),
		value: z.number().int().min(0).max(100000),
		reason,
	}),
	z.object({
		action: z.literal("access.user.approve"),
		targetId: z.uuid(),
		expiresAt: expiration,
		reason,
	}),
	z.object({
		action: z.literal("access.user.pending"),
		targetId: z.uuid(),
		reason,
	}),
	z.object({
		action: z.literal("access.user.revoke"),
		targetId: z.uuid(),
		reason,
	}),
	z.object({
		action: z.literal("access.user.expiry.update"),
		targetId: z.uuid(),
		expiresAt: expiration,
		reason,
	}),
	z.object({
		action: z.literal("access.role.assign"),
		targetId: z.uuid(),
		role: appRoleKey,
		expiresAt: expiration,
		reason,
	}),
	z.object({
		action: z.literal("access.role.revoke"),
		targetId: z.uuid(),
		role: appRoleKey,
		reason,
	}),
	z.object({
		action: z.literal("access.permission.allow"),
		targetId: z.uuid(),
		permission: appPermissionKey,
		expiresAt: expiration,
		reason,
	}),
	z.object({
		action: z.literal("access.permission.deny"),
		targetId: z.uuid(),
		permission: appPermissionKey,
		expiresAt: expiration,
		reason,
	}),
	z.object({
		action: z.literal("access.permission.remove"),
		targetId: z.uuid(),
		permission: appPermissionKey,
		reason,
	}),
	z.object({
		action: z.literal("access.site_mode.update"),
		targetId: z.literal("global"),
		mode: z.enum(["coming_soon", "maintenance", "public"]),
		reason,
	}),
	z.object({
		action: z.literal("access.signup_policy.update"),
		targetId: z.literal("global"),
		allowSignups: z.boolean(),
		reason,
	}),
	z.object({
		action: z.literal("access.messages.update"),
		targetId: z.literal("global"),
		comingSoonMessage: z.string().trim().min(20).max(1000).optional(),
		maintenanceMessage: z.string().trim().min(20).max(1000).optional(),
		reason,
	}),
	z.object({
		action: z.literal("transcription.config.create_draft"),
		targetId: z.literal("new"),
		provider: transcriptionProvider,
		model: z.string().trim().min(1).max(120),
		providerOptions: transcriptionProviderOptions,
		pipelineOptions,
		reason,
	}),
	z.object({
		action: z.literal("transcription.config.test"),
		targetId: z.uuid(),
		version: z.number().int().min(1),
		reason,
	}),
	z.object({
		action: z.literal("transcription.config.activate"),
		targetId: z.uuid(),
		version: z.number().int().min(1),
		confirmation: z.literal("ACTIVATE"),
		reason,
	}),
	z.object({
		action: z.literal("transcription.config.deactivate"),
		targetId: z.uuid(),
		reason,
	}),
]);

const transcriptionConfigurationReturning = {
	id: transcriptionConfigurations.id,
	provider: transcriptionConfigurations.provider,
	model: transcriptionConfigurations.model,
	providerOptions: transcriptionConfigurations.providerOptions,
	timestampStrategy: transcriptionConfigurations.timestampStrategy,
	strictProvider: transcriptionConfigurations.strictProvider,
	status: transcriptionConfigurations.status,
	version: transcriptionConfigurations.version,
	testStatus: transcriptionConfigurations.testStatus,
	testedAt: transcriptionConfigurations.testedAt,
	testedBy: transcriptionConfigurations.testedBy,
	testErrorCode: transcriptionConfigurations.testErrorCode,
	testLatencyMs: transcriptionConfigurations.testLatencyMs,
	activatedAt: transcriptionConfigurations.activatedAt,
	activatedBy: transcriptionConfigurations.activatedBy,
	activationReason: transcriptionConfigurations.activationReason,
	createdAt: transcriptionConfigurations.createdAt,
	updatedAt: transcriptionConfigurations.updatedAt,
};

type Mutation = z.infer<typeof schema>;

function safeMutationError(error: unknown) {
	const raw = error instanceof Error ? error.message : "mutation_failed";
	const allowedCodes = new Set([
		"unsupported_model",
		"invalid_provider_options",
		"stale_configuration",
		"untested_configuration",
		"target_not_found",
		"provider_test_failed",
		"forced_alignment_unavailable",
	]);
	const normalized = raw.toLowerCase();
	const code = allowedCodes.has(raw)
		? raw
		: normalized.includes("relation") || normalized.includes("column")
			? "database_schema_missing"
			: normalized.includes("duplicate") || normalized.includes("constraint")
				? "database_constraint"
				: "mutation_failed";
	const messages: Record<string, string> = {
		unsupported_model: "The selected provider/model is not supported.",
		invalid_provider_options: "The selected provider options are invalid.",
		stale_configuration: "This configuration version is stale. Refresh and choose the latest saved version.",
		untested_configuration: "This exact configuration version must pass a real-audio test before activation.",
		target_not_found: "The selected configuration could not be found.",
		provider_test_failed: "The backend provider test failed.",
		forced_alignment_unavailable: "This model requires forced alignment, but the backend aligner is unavailable.",
		database_schema_missing: "The transcription configuration database schema is missing or out of date.",
		database_constraint: "The database rejected the configuration change.",
		mutation_failed: "The operation could not be completed.",
	};
	return {
		code,
		error: messages[code] ?? messages.mutation_failed,
	};
}

function withTranscriptionMetadata(
	{
		action,
		after,
		context,
	}: {
		action: string;
		after: unknown;
		context: AdminContext | undefined;
	},
) {
	if (!action.startsWith("transcription.config.") || !isRecord(after)) {
		return after;
	}
	return {
		...after,
		createdBy: context?.userId ?? null,
		activationEligibility:
			after.status === "draft" && after.testStatus === "passed",
	};
}

function permissionFor(value: Mutation) {
	if (value.action === "user.suspend") return "users.suspend" as const;
	if (value.action === "user.restore") return "users.restore" as const;
	if (
		["user.sessions.revoke", "admin.role.assign", "admin.role.revoke"].includes(
			value.action,
		)
	)
		return "users.manage_roles" as const;
	if (["user.delete.schedule", "user.delete.cancel"].includes(value.action))
		return "users.schedule_delete" as const;
	if (value.action === "admin.mfa.reset")
		return "security.reset_admin_mfa" as const;
	if (value.action === "quota.update" || value.action === "setting.update")
		return "system.manage_limits" as const;
	if (value.action === "access.site_mode.update")
		return "access.manage_site_mode" as const;
	if (
		value.action === "access.signup_policy.update" ||
		value.action === "access.messages.update"
	)
		return "access.manage_site_mode" as const;
	if (
		value.action === "access.role.assign" ||
		value.action === "access.role.revoke" ||
		value.action.startsWith("access.permission.")
	)
		return "access.manage_permissions" as const;
	if (value.action.startsWith("access.user."))
		return "access.manage_users" as const;
	if (value.action.startsWith("feature_flag."))
		return "feature_flags.manage" as const;
	if (value.action === "security.unblock")
		return "security.unblock_ip" as const;
	if (value.action.startsWith("transcription.config."))
		return "system.manage_providers" as const;
	if (value.action === "project.retention")
		return "projects.extend_retention" as const;
	return value.action === "support.update" && value.assigneeUserId !== undefined
		? ("feedback.assign" as const)
		: ("feedback.manage" as const);
}

function isHighRisk(value: Mutation) {
	if (value.action.startsWith("transcription.config.")) return false;
	if (value.action.startsWith("access.")) return true;
	return ![
		"user.suspend",
		"user.restore",
		"support.update",
		"support.note",
		"project.retention",
	].includes(value.action);
}

async function revokeSupabaseSessions(userId: string) {
	await db.execute(
		sql`delete from auth.sessions where user_id = ${userId}::uuid`,
	);
}

async function ensureRecoveryAdminRemains(targetId: string) {
	const [row] = await db.execute(sql`
		select count(*)::int as count
		from admin_role_members m
		join admin_roles r on r.id = m.role_id
		join profiles p on p.user_id = m.user_id
		where r.key = 'super_admin' and m.active = true
		  and p.account_status = 'active' and m.user_id <> ${targetId}::uuid
	`);
	if (!row || Number(row.count) < 1)
		throw new Error("final_super_admin_protected");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

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
	const metadata = await getAdminRequestMetadata();
	const rate = await checkAdminApiRateLimit({
		key: metadata.ipHash,
		kind: isHighRisk(value) ? "critical" : "mutation",
	});
	if (!rate.success) {
		return NextResponse.json(
			{ error: "Too many requests." },
			{
				status: 429,
				headers: {
					"Retry-After": String(
						Math.max(1, Math.ceil((rate.reset - Date.now()) / 1000)),
					),
				},
			},
		);
	}

	let context: AdminContext | undefined;
	let beforeValue: unknown;
	let afterValue: unknown;
	try {
		context = await requireAdminPermission(permissionFor(value));
		if (isHighRisk(value)) await requireRecentMfaForSensitiveAction();
		if (
			value.action === "transcription.config.test" ||
			value.action === "transcription.config.activate" ||
			value.action === "transcription.config.deactivate"
		) {
			await requireRecentMfaForSensitiveAction();
		}
		if (
			(value.action === "admin.role.assign" ||
				value.action === "admin.role.revoke") &&
			value.targetId === context.userId
		) {
			throw new Error("self_role_change_denied");
		}

		let securityBlock:
			| { ipHash: string | null; emailHash: string | null }
			| undefined;
		if (value.action === "admin.mfa.reset") {
			await ensureRecoveryAdminRemains(value.targetId);
			const [membership] = await db
				.select()
				.from(adminRoleMembers)
				.where(
					and(
						eq(adminRoleMembers.userId, value.targetId),
						eq(adminRoleMembers.active, true),
					),
				)
				.limit(1);
			if (!membership) throw new Error("target_not_admin");
			const supabase = createSupabaseAdminClient();
			const { data, error } = await supabase.auth.admin.getUserById(
				value.targetId,
			);
			if (error || !data.user) throw new Error("target_not_found");
			const factors = data.user.factors ?? [];
			for (const factor of factors) {
				const result = await supabase.auth.admin.mfa.deleteFactor({
					userId: value.targetId,
					id: factor.id,
				});
				if (result.error) throw new Error("mfa_factor_delete_failed");
			}
			await revokeSupabaseSessions(value.targetId);
		}

		await db.transaction(async (tx) => {
			if (value.action === "user.suspend" || value.action === "user.restore") {
				[beforeValue] = await tx
					.select()
					.from(profiles)
					.where(eq(profiles.userId, value.targetId))
					.limit(1);
				if (!beforeValue) throw new Error("target_not_found");
				[afterValue] = await tx
					.update(profiles)
					.set({
						accountStatus:
							value.action === "user.suspend" ? "suspended" : "active",
						suspendedAt: value.action === "user.suspend" ? new Date() : null,
						suspensionReason:
							value.action === "user.suspend" ? value.reason : null,
						updatedAt: new Date(),
					})
					.where(eq(profiles.userId, value.targetId))
					.returning();
			} else if (value.action === "admin.role.assign") {
				const [role] = await tx
					.select()
					.from(adminRoles)
					.where(eq(adminRoles.key, value.role))
					.limit(1);
				if (!role) throw new Error("unsupported_role");
				const active = await tx
					.select()
					.from(adminRoleMembers)
					.where(
						and(
							eq(adminRoleMembers.userId, value.targetId),
							eq(adminRoleMembers.roleId, role.id),
							eq(adminRoleMembers.active, true),
						),
					);
				if (active.length) throw new Error("duplicate_active_membership");
				beforeValue = active;
				[afterValue] = await tx
					.insert(adminRoleMembers)
					.values({
						userId: value.targetId,
						roleId: role.id,
						assignedBy: context!.userId,
						reason: value.reason,
					})
					.returning();
			} else if (value.action === "admin.role.revoke") {
				const [role] = await tx
					.select()
					.from(adminRoles)
					.where(eq(adminRoles.key, value.role))
					.limit(1);
				if (!role) throw new Error("unsupported_role");
				if (value.role === "super_admin")
					await ensureRecoveryAdminRemains(value.targetId);
				const [membership] = await tx
					.select()
					.from(adminRoleMembers)
					.where(
						and(
							eq(adminRoleMembers.userId, value.targetId),
							eq(adminRoleMembers.roleId, role.id),
							eq(adminRoleMembers.active, true),
						),
					)
					.limit(1);
				if (!membership) throw new Error("active_membership_not_found");
				beforeValue = membership;
				[afterValue] = await tx
					.update(adminRoleMembers)
					.set({
						active: false,
						revokedBy: context!.userId,
						revokedAt: new Date(),
						reason: value.reason,
					})
					.where(eq(adminRoleMembers.id, membership.id))
					.returning();
			} else if (
				value.action === "user.delete.schedule" ||
				value.action === "user.delete.cancel"
			) {
				[beforeValue] = await tx
					.select()
					.from(profiles)
					.where(eq(profiles.userId, value.targetId))
					.limit(1);
				if (!beforeValue) throw new Error("target_not_found");
				const deletionAt =
					value.action === "user.delete.schedule"
						? new Date(Date.now() + value.graceDays * 86400000)
						: null;
				[afterValue] = await tx
					.update(profiles)
					.set({
						accountStatus: deletionAt ? "deletion_scheduled" : "active",
						scheduledDeletionAt: deletionAt,
						updatedAt: new Date(),
					})
					.where(eq(profiles.userId, value.targetId))
					.returning();
			} else if (value.action === "quota.update") {
				[beforeValue] = await tx
					.select()
					.from(userQuotas)
					.where(eq(userQuotas.userId, value.targetId))
					.limit(1);
				[afterValue] = await tx
					.insert(userQuotas)
					.values({
						userId: value.targetId,
						...value.quotas,
						updatedBy: context!.userId,
					})
					.onConflictDoUpdate({
						target: userQuotas.userId,
						set: {
							...value.quotas,
							updatedBy: context!.userId,
							updatedAt: new Date(),
						},
					})
					.returning();
			} else if (
				value.action === "feature_flag.update" ||
				value.action === "feature_flag.rollback"
			) {
				const [currentFlag] = await tx
					.select()
					.from(featureFlags)
					.where(eq(featureFlags.key, value.targetId))
					.limit(1);
				if (!currentFlag) throw new Error("target_not_found");
				beforeValue = currentFlag;
				let enabled: boolean;
				let configuration: Record<string, unknown>;
				if (value.action === "feature_flag.rollback") {
					const [version] = await tx
						.select()
						.from(featureFlagVersions)
						.where(
							and(
								eq(featureFlagVersions.key, value.targetId),
								eq(featureFlagVersions.version, value.version),
							),
						)
						.limit(1);
					if (!version) throw new Error("version_not_found");
					enabled = version.enabled;
					configuration = version.configuration;
				} else {
					enabled = value.enabled;
					configuration = value.configuration ?? currentFlag.configuration;
				}
				const nextVersion = currentFlag.version + 1;
				[afterValue] = await tx
					.update(featureFlags)
					.set({
						enabled,
						configuration,
						updatedBy: context!.userId,
						updatedAt: new Date(),
						version: nextVersion,
					})
					.where(eq(featureFlags.key, value.targetId))
					.returning();
				await tx.insert(featureFlagVersions).values({
					key: value.targetId,
					enabled,
					configuration,
					version: nextVersion,
					changedBy: context!.userId,
					reason: value.reason,
				});
			} else if (value.action === "setting.update") {
				[beforeValue] = await tx
					.select()
					.from(systemSettings)
					.where(eq(systemSettings.key, value.targetId))
					.limit(1);
				[afterValue] = await tx
					.insert(systemSettings)
					.values({
						key: value.targetId,
						value: value.value,
						description: value.targetId.replaceAll("_", " "),
						updatedBy: context!.userId,
					})
					.onConflictDoUpdate({
						target: systemSettings.key,
						set: {
							value: value.value,
							updatedBy: context!.userId,
							updatedAt: new Date(),
						},
					})
					.returning();
			} else if (
				value.action === "access.user.approve" ||
				value.action === "access.user.pending" ||
				value.action === "access.user.revoke" ||
				value.action === "access.user.expiry.update"
			) {
				if (value.targetId === context!.userId && value.action !== "access.user.expiry.update")
					throw new Error("self_access_change_denied");
				[beforeValue] = await tx
					.select()
					.from(profiles)
					.where(eq(profiles.userId, value.targetId))
					.limit(1);
				if (!beforeValue) throw new Error("target_not_found");
				const status =
					value.action === "access.user.approve"
						? "approved"
						: value.action === "access.user.pending"
							? "pending"
							: value.action === "access.user.revoke"
								? "revoked"
								: undefined;
				[afterValue] = await tx
					.update(profiles)
					.set({
						...(status ? { productAccessStatus: status } : {}),
						productAccessApprovedAt:
							status === "approved" ? new Date() : undefined,
						productAccessExpiresAt:
							value.action === "access.user.approve" ||
							value.action === "access.user.expiry.update"
								? value.expiresAt
								: null,
						productAccessUpdatedAt: new Date(),
						productAccessUpdatedBy: context!.userId,
						productAccessReason: value.reason,
						updatedAt: new Date(),
					})
					.where(eq(profiles.userId, value.targetId))
					.returning();
			} else if (
				value.action === "access.role.assign" ||
				value.action === "access.role.revoke"
			) {
				if (value.targetId === context!.userId)
					throw new Error("self_role_change_denied");
				const [role] = await tx
					.select()
					.from(appRoles)
					.where(eq(appRoles.key, value.role))
					.limit(1);
				if (!role) throw new Error("unsupported_role");
				if (value.action === "access.role.assign") {
					const active = await tx
						.select()
						.from(appRoleMembers)
						.where(
							and(
								eq(appRoleMembers.userId, value.targetId),
								eq(appRoleMembers.roleId, role.id),
								eq(appRoleMembers.active, true),
							),
						);
					if (active.length) throw new Error("duplicate_active_membership");
					beforeValue = active;
					[afterValue] = await tx
						.insert(appRoleMembers)
						.values({
							userId: value.targetId,
							roleId: role.id,
							assignedBy: context!.userId,
							reason: value.reason,
							expiresAt: value.expiresAt,
						})
						.returning();
				} else {
					const [membership] = await tx
						.select()
						.from(appRoleMembers)
						.where(
							and(
								eq(appRoleMembers.userId, value.targetId),
								eq(appRoleMembers.roleId, role.id),
								eq(appRoleMembers.active, true),
							),
						)
						.limit(1);
					if (!membership) throw new Error("active_membership_not_found");
					beforeValue = membership;
					[afterValue] = await tx
						.update(appRoleMembers)
						.set({
							active: false,
							revokedBy: context!.userId,
							revokedAt: new Date(),
							reason: value.reason,
						})
						.where(eq(appRoleMembers.id, membership.id))
						.returning();
				}
			} else if (
				value.action === "access.permission.allow" ||
				value.action === "access.permission.deny" ||
				value.action === "access.permission.remove"
			) {
				if (value.targetId === context!.userId)
					throw new Error("self_permission_change_denied");
				const [permission] = await tx
					.select()
					.from(appPermissions)
					.where(eq(appPermissions.key, value.permission))
					.limit(1);
				if (!permission) throw new Error("unsupported_permission");
				const [currentOverride] = await tx
					.select()
					.from(appUserPermissionOverrides)
					.where(
						and(
							eq(appUserPermissionOverrides.userId, value.targetId),
							eq(appUserPermissionOverrides.permissionId, permission.id),
							eq(appUserPermissionOverrides.active, true),
						),
					)
					.limit(1);
				beforeValue = currentOverride ?? null;
				if (currentOverride) {
					await tx
						.update(appUserPermissionOverrides)
						.set({
							active: false,
							revokedBy: context!.userId,
							revokedAt: new Date(),
						})
						.where(eq(appUserPermissionOverrides.id, currentOverride.id));
				}
				if (value.action === "access.permission.remove") {
					afterValue = null;
				} else {
					[afterValue] = await tx
						.insert(appUserPermissionOverrides)
						.values({
							userId: value.targetId,
							permissionId: permission.id,
							effect:
								value.action === "access.permission.allow" ? "allow" : "deny",
							assignedBy: context!.userId,
							reason: value.reason,
							expiresAt: value.expiresAt,
						})
						.returning();
				}
			} else if (
				value.action === "access.site_mode.update" ||
				value.action === "access.signup_policy.update" ||
				value.action === "access.messages.update"
			) {
				[beforeValue] = await tx
					.select()
					.from(siteAccessPolicy)
					.where(eq(siteAccessPolicy.id, "global"))
					.limit(1);
				const update =
					value.action === "access.site_mode.update"
						? { mode: value.mode }
						: value.action === "access.signup_policy.update"
							? { allowSignups: value.allowSignups }
							: {
									...(value.comingSoonMessage
										? { comingSoonMessage: value.comingSoonMessage }
										: {}),
									...(value.maintenanceMessage
										? { maintenanceMessage: value.maintenanceMessage }
										: {}),
								};
				[afterValue] = await tx
					.insert(siteAccessPolicy)
					.values({
						id: "global",
						mode:
							value.action === "access.site_mode.update"
								? value.mode
								: "public",
						allowSignups:
							value.action === "access.signup_policy.update"
								? value.allowSignups
								: true,
						updatedBy: context!.userId,
					})
					.onConflictDoUpdate({
						target: siteAccessPolicy.id,
						set: {
							...update,
							version: sql`${siteAccessPolicy.version} + 1`,
							updatedBy: context!.userId,
							updatedAt: new Date(),
						},
					})
					.returning();
			} else if (value.action === "transcription.config.create_draft") {
				const entry = getTranscriptionCatalogEntry({
					provider: value.provider,
					model: value.model,
				});
				if (!entry) throw new Error("unsupported_model");
				const providerOptions =
					value.provider === "sarvam"
						? { ...defaultProviderOptions(value.provider), ...(value.providerOptions ?? {}) }
						: {};
				const resolvedPipelineOptions = mergePipelineOptions(
					DEFAULT_PIPELINE_OPTIONS,
					value.pipelineOptions ?? {},
				);
				const supportedProviderModes: readonly string[] = entry.supportedProviderModes;
				if (
					value.provider === "sarvam" &&
					!supportedProviderModes.includes(String(providerOptions.mode ?? "transcribe"))
				)
					throw new Error("invalid_provider_options");
				beforeValue = null;
				const hasPipelineOptions =
					await transcriptionPipelineOptionsColumnExists(tx);
				const createValues = {
					provider: value.provider,
					model: value.model,
					providerOptions,
					timestampStrategy: entry.timestampStrategy,
					strictProvider: true,
					status: "draft",
					testStatus: "untested",
				};
				const values = hasPipelineOptions
					? { ...createValues, pipelineOptions: resolvedPipelineOptions }
					: createValues;
				const [created] = await tx
					.insert(transcriptionConfigurations)
					.values(values)
					.returning(transcriptionConfigurationReturning);
				afterValue = {
					...created,
					pipelineOptions: resolvedPipelineOptions,
					createdBy: context!.userId,
					activationEligibility: false,
				};
				await tx.insert(transcriptionConfigurationVersions).values({
					configurationId: created.id,
					version: created.version,
					action: "create_draft",
					beforeSnapshot: beforeValue,
					afterSnapshot: afterValue,
					reason: value.reason,
					changedBy: context!.userId,
				});
			} else if (value.action === "transcription.config.test") {
				const current = await getAdminTranscriptionConfiguration(tx, value.targetId);
				if (!current) throw new Error("target_not_found");
				if (current.version !== value.version) throw new Error("stale_configuration");
				const entry = getTranscriptionCatalogEntry({
					provider: current.provider,
					model: current.model,
				});
				if (!entry || entry.timestampStrategy !== current.timestampStrategy)
					throw new Error("unsupported_model");
				if (entry.localAlignmentRequired) {
					const timingResponse = await adminBackendFetch({
						path: "/health/timing",
						permission: "system.manage_providers",
					});
					const timingPayload = (await timingResponse.json().catch(() => null)) as unknown;
					const realForcedAlignmentAvailable =
						isRecord(timingPayload) && timingPayload.realForcedAlignmentAvailable === true;
					if (!timingResponse.ok || !realForcedAlignmentAvailable) {
						throw new Error("forced_alignment_unavailable");
					}
				}
				beforeValue = current;
				const response = await adminBackendFetch({
					path: "/api/admin/transcription/test",
					permission: "system.manage_providers",
					init: {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							configurationId: current.id,
							provider: current.provider,
							model: current.model,
							version: current.version,
							timestampStrategy: current.timestampStrategy,
							strictProvider: current.strictProvider,
							providerOptions: current.providerOptions,
							pipelineOptions: current.pipelineOptions,
							reason: value.reason,
						}),
					},
				});
				const rawTestResult: unknown = await response.json().catch(() => null);
				const testResult = isRecord(rawTestResult) ? rawTestResult : null;
				if (!response.ok || !testResult) throw new Error("provider_test_failed");
				const testPassed = testResult.ok === true;
				const testCategory =
					typeof testResult.category === "string"
						? testResult.category
						: "unknown_provider_error";
				const latencyMs =
					typeof testResult.latencyMs === "number" ? testResult.latencyMs : null;
				const [tested] = await tx
					.update(transcriptionConfigurations)
					.set({
						status: testPassed ? "draft" : "failed_test",
						testStatus: testPassed ? "passed" : "failed",
						testedAt: new Date(),
						testedBy: context!.userId,
						testErrorCode: testPassed ? null : testCategory,
						testLatencyMs: latencyMs,
						updatedAt: new Date(),
					})
					.where(eq(transcriptionConfigurations.id, current.id))
					.returning(transcriptionConfigurationReturning);
				afterValue = {
					...tested,
					pipelineOptions: current.pipelineOptions,
					createdBy: context!.userId,
					activationEligibility: tested.testStatus === "passed",
				};
				await tx.insert(transcriptionConfigurationVersions).values({
					configurationId: current.id,
					version: current.version,
					action: "test",
					beforeSnapshot: beforeValue,
					afterSnapshot: { configuration: tested, test: testResult },
					reason: value.reason,
					changedBy: context!.userId,
				});
			} else if (value.action === "transcription.config.activate") {
				const current = await getAdminTranscriptionConfiguration(tx, value.targetId);
				if (!current) throw new Error("target_not_found");
				if (current.version !== value.version) throw new Error("stale_configuration");
				if (current.testStatus !== "passed") throw new Error("untested_configuration");
				const entry = getTranscriptionCatalogEntry({
					provider: current.provider,
					model: current.model,
				});
				if (!entry || entry.timestampStrategy !== current.timestampStrategy)
					throw new Error("unsupported_model");
				if (entry.localAlignmentRequired) {
					const timingResponse = await adminBackendFetch({
						path: "/health/timing",
						permission: "system.manage_providers",
					});
					const timingPayload = (await timingResponse.json().catch(() => null)) as unknown;
					const realForcedAlignmentAvailable =
						isRecord(timingPayload) && timingPayload.realForcedAlignmentAvailable === true;
					if (!timingResponse.ok || !realForcedAlignmentAvailable) {
						throw new Error("forced_alignment_unavailable");
					}
				}
				beforeValue = current;
				await tx
					.update(transcriptionConfigurations)
					.set({ status: "inactive", updatedAt: new Date() })
					.where(eq(transcriptionConfigurations.status, "active"));
				const [activated] = await tx
					.update(transcriptionConfigurations)
					.set({
						status: "active",
						version: sql`${transcriptionConfigurations.version} + 1`,
						activatedAt: new Date(),
						activatedBy: context!.userId,
						activationReason: value.reason,
						updatedAt: new Date(),
					})
					.where(eq(transcriptionConfigurations.id, current.id))
					.returning(transcriptionConfigurationReturning);
				afterValue = {
					...activated,
					pipelineOptions: current.pipelineOptions,
					createdBy: context!.userId,
					activationEligibility: true,
				};
				await tx.insert(transcriptionConfigurationVersions).values({
					configurationId: current.id,
					version: activated.version,
					action: "activate",
					beforeSnapshot: beforeValue,
					afterSnapshot: activated,
					reason: value.reason,
					changedBy: context!.userId,
				});
			} else if (value.action === "transcription.config.deactivate") {
				const current = await getAdminTranscriptionConfiguration(tx, value.targetId);
				if (!current) throw new Error("target_not_found");
				beforeValue = current;
				const [deactivated] = await tx
					.update(transcriptionConfigurations)
					.set({
						status: "inactive",
						version: sql`${transcriptionConfigurations.version} + 1`,
						updatedAt: new Date(),
					})
					.where(eq(transcriptionConfigurations.id, current.id))
					.returning(transcriptionConfigurationReturning);
				afterValue = {
					...deactivated,
					pipelineOptions: current.pipelineOptions,
					createdBy: context!.userId,
					activationEligibility: false,
				};
				await tx.insert(transcriptionConfigurationVersions).values({
					configurationId: current.id,
					version: deactivated.version,
					action: "deactivate",
					beforeSnapshot: beforeValue,
					afterSnapshot: deactivated,
					reason: value.reason,
					changedBy: context!.userId,
				});
			} else if (value.action === "security.unblock") {
				const [securityEvent] = await tx
					.select()
					.from(adminSecurityEvents)
					.where(
						and(
							eq(adminSecurityEvents.id, value.targetId),
							sql`${adminSecurityEvents.resolvedAt} is null`,
						),
					)
					.limit(1);
				if (!securityEvent) throw new Error("target_not_found");
				beforeValue = securityEvent;
				securityBlock = {
					ipHash: securityEvent.ipHash,
					emailHash: securityEvent.emailHash,
				};
				[afterValue] = await tx
					.update(adminSecurityEvents)
					.set({
						resolvedAt: new Date(),
						resolvedBy: context!.userId,
						resolutionReason: value.reason,
						updatedAt: new Date(),
					})
					.where(eq(adminSecurityEvents.id, value.targetId))
					.returning();
			} else if (value.action === "project.retention") {
				[beforeValue] = await tx
					.select()
					.from(projectRegistry)
					.where(eq(projectRegistry.projectId, value.targetId))
					.limit(1);
				if (!beforeValue) throw new Error("target_not_found");
				const update =
					value.mode === "extend"
						? { expiresAt: new Date(Date.now() + (value.days ?? 7) * 86400000) }
						: {
								retentionHold: value.mode === "hold",
								retentionHoldReason:
									value.mode === "hold" ? value.reason : null,
							};
				[afterValue] = await tx
					.update(projectRegistry)
					.set({ ...update, updatedAt: new Date() })
					.where(eq(projectRegistry.projectId, value.targetId))
					.returning();
			} else if (
				value.action === "support.update" ||
				value.action === "support.note"
			) {
				const [supportCase] = await tx
					.select()
					.from(supportCases)
					.where(eq(supportCases.id, value.targetId))
					.limit(1);
				if (!supportCase) throw new Error("target_not_found");
				beforeValue = supportCase;
				if (value.action === "support.note") {
					[afterValue] = await tx
						.update(supportCases)
						.set({
							internalNotes: sql`concat_ws(E'\n\n', ${supportCases.internalNotes}, ${value.note})`,
							updatedAt: new Date(),
						})
						.where(eq(supportCases.id, value.targetId))
						.returning();
				} else {
					const current = supportCase;
					const status = value.status ?? current.status;
					if (
						current.status === "closed" &&
						!["investigating", "new"].includes(status)
					)
						throw new Error("invalid_status_transition");
					[afterValue] = await tx
						.update(supportCases)
						.set({
							status,
							priority: value.priority ?? current.priority,
							category: value.category ?? current.category,
							assigneeUserId:
								value.assigneeUserId === undefined
									? current.assigneeUserId
									: value.assigneeUserId,
							userId:
								value.userId === undefined ? current.userId : value.userId,
							projectId:
								value.projectId === undefined
									? current.projectId
									: value.projectId,
							captionJobId:
								value.captionJobId === undefined
									? current.captionJobId
									: value.captionJobId,
							exportJobId:
								value.exportJobId === undefined
									? current.exportJobId
									: value.exportJobId,
							resolution:
								value.resolution === undefined
									? current.resolution
									: value.resolution,
							resolvedAt:
								status === "resolved"
									? new Date()
									: status === "new" || status === "investigating"
										? null
										: current.resolvedAt,
							updatedAt: new Date(),
						})
						.where(eq(supportCases.id, value.targetId))
						.returning();
				}
				await tx.insert(supportCaseEvents).values({
					caseId: value.targetId,
					adminUserId: context!.userId,
					action: value.action,
					beforeValue,
					afterValue,
					note: value.action === "support.note" ? value.note : value.reason,
				});
			} else if (value.action === "admin.mfa.reset") {
				[beforeValue] = await tx
					.select()
					.from(profiles)
					.where(eq(profiles.userId, value.targetId))
					.limit(1);
				[afterValue] = await tx
					.update(profiles)
					.set({ adminMfaResetRequired: true, updatedAt: new Date() })
					.where(eq(profiles.userId, value.targetId))
					.returning();
			} else if (value.action === "user.sessions.revoke") {
				beforeValue = { userId: value.targetId, sessions: "active" };
				afterValue = { userId: value.targetId, sessions: "revoked" };
			}
		});

		if (securityBlock) await clearAdminSecurityBlock(securityBlock);
		if (
			value.action === "user.suspend" ||
			value.action === "user.sessions.revoke" ||
			value.action === "admin.role.revoke" ||
			value.action === "access.user.revoke"
		) {
			await revokeSupabaseSessions(value.targetId);
		}
		const correlationId = await recordAdminAuditEvent({
			context,
			action: value.action,
			targetType: value.action.split(".")[0],
			targetId: value.targetId,
			reason: value.reason,
			beforeValue,
			afterValue,
			success: true,
			severity: isHighRisk(value) ? "high" : "info",
		});
		if (
			value.action.startsWith("feature_flag.") ||
			value.action === "setting.update"
		) {
			revalidatePath("/admincapinsta11/feature-flags");
			revalidatePath("/sign-up");
		}
		if (value.action.startsWith("access.")) {
			invalidateSiteAccessPolicy();
			revalidatePath("/");
			revalidatePath("/admincapinsta11/access-control");
			revalidatePath("/admincapinsta11/users");
			revalidatePath(`/admincapinsta11/users/${value.targetId}`);
		}
		if (value.action.startsWith("transcription.config.")) {
			revalidatePath("/admincapinsta11/transcription");
			if (
				value.action === "transcription.config.activate" ||
				value.action === "transcription.config.deactivate"
			) {
				await adminBackendFetch({
					path: "/api/admin/transcription/cache/invalidate",
					permission: "system.manage_providers",
					init: {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"Idempotency-Key": crypto.randomUUID(),
						},
						body: JSON.stringify({ reason: value.reason }),
					},
				}).catch(() => null);
			}
		}
		return NextResponse.json({
			ok: true,
			correlationId,
			after: withTranscriptionMetadata({
				action: value.action,
				after: afterValue,
				context,
			}),
		});
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
			beforeValue,
			afterValue,
			success: false,
			failureCode:
				error instanceof Error ? error.message.slice(0, 80) : "mutation_failed",
			severity: "high",
		});
		return NextResponse.json(safeMutationError(error), { status: 400 });
	}
}
