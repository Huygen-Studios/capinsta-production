import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	date,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

const auditColumns = {
	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
};

export const profiles = pgTable(
	"profiles",
	{
		userId: uuid("user_id").primaryKey(),
		displayName: text("display_name"),
		emailSnapshot: text("email_snapshot"),
		accountStatus: text("account_status").default("active").notNull(),
		productAccessStatus: text("product_access_status")
			.default("pending")
			.notNull(),
		productAccessApprovedAt: timestamp("product_access_approved_at", {
			withTimezone: true,
		}),
		productAccessExpiresAt: timestamp("product_access_expires_at", {
			withTimezone: true,
		}),
		productAccessUpdatedAt: timestamp("product_access_updated_at", {
			withTimezone: true,
		}),
		productAccessUpdatedBy: uuid("product_access_updated_by"),
		productAccessReason: text("product_access_reason"),
		authProviderSnapshot: text("auth_provider_snapshot"),
		emailConfirmedAt: timestamp("email_confirmed_at", { withTimezone: true }),
		lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
		suspendedAt: timestamp("suspended_at", { withTimezone: true }),
		suspensionReason: text("suspension_reason"),
		scheduledDeletionAt: timestamp("scheduled_deletion_at", {
			withTimezone: true,
		}),
		adminMfaResetRequired: boolean("admin_mfa_reset_required")
			.default(false)
			.notNull(),
	},
	(table) => [
		index("profiles_status_created_idx").on(
			table.accountStatus,
			table.createdAt,
		),
		index("profiles_product_access_created_idx").on(
			table.productAccessStatus,
			table.createdAt,
		),
		index("profiles_product_access_expires_idx").on(
			table.productAccessExpiresAt,
		),
		index("profiles_email_idx").on(table.emailSnapshot),
	],
);

export const siteAccessPolicy = pgTable("site_access_policy", {
	id: text("id").primaryKey().default("global"),
	mode: text("mode").default("public").notNull(),
	allowSignups: boolean("allow_signups").default(true).notNull(),
	comingSoonMessage: text("coming_soon_message")
		.default(
			"Create your Capinsta account to join the private beta. We're inviting creators and editors in small groups while we improve timing, editing and export reliability.",
		)
		.notNull(),
	maintenanceMessage: text("maintenance_message")
		.default(
			"We're making improvements to the application. Your account and projects remain safe.",
		)
		.notNull(),
	version: integer("version").default(1).notNull(),
	updatedBy: uuid("updated_by"),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
});

export const appRoles = pgTable("app_roles", {
	id: uuid("id").defaultRandom().primaryKey(),
	key: text("key").notNull().unique(),
	name: text("name").notNull(),
	description: text("description").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
});

export const appPermissions = pgTable("app_permissions", {
	id: uuid("id").defaultRandom().primaryKey(),
	key: text("key").notNull().unique(),
	description: text("description").notNull(),
});

export const appRolePermissions = pgTable(
	"app_role_permissions",
	{
		roleId: uuid("role_id")
			.notNull()
			.references(() => appRoles.id, { onDelete: "cascade" }),
		permissionId: uuid("permission_id")
			.notNull()
			.references(() => appPermissions.id, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.roleId, table.permissionId] })],
);

export const appRoleMembers = pgTable(
	"app_role_members",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: uuid("user_id").notNull(),
		roleId: uuid("role_id")
			.notNull()
			.references(() => appRoles.id),
		active: boolean("active").default(true).notNull(),
		assignedBy: uuid("assigned_by"),
		assignedAt: timestamp("assigned_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		revokedBy: uuid("revoked_by"),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		reason: text("reason").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }),
	},
	(table) => [
		index("app_role_members_user_active_idx").on(table.userId, table.active),
		index("app_role_members_expires_idx").on(table.expiresAt),
		uniqueIndex("app_role_members_active_role_idx")
			.on(table.userId, table.roleId)
			.where(sql`${table.active} = true`),
	],
);

export const appUserPermissionOverrides = pgTable(
	"app_user_permission_overrides",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: uuid("user_id").notNull(),
		permissionId: uuid("permission_id")
			.notNull()
			.references(() => appPermissions.id),
		effect: text("effect").notNull(),
		active: boolean("active").default(true).notNull(),
		assignedBy: uuid("assigned_by"),
		assignedAt: timestamp("assigned_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		revokedBy: uuid("revoked_by"),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		reason: text("reason").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }),
	},
	(table) => [
		index("app_permission_overrides_user_active_idx").on(
			table.userId,
			table.active,
		),
		index("app_permission_overrides_expires_idx").on(table.expiresAt),
		uniqueIndex("app_permission_overrides_active_idx")
			.on(table.userId, table.permissionId)
			.where(sql`${table.active} = true`),
	],
);

export const appProductEntitlements = pgTable(
	"app_product_entitlements",
	{
		userId: uuid("user_id").notNull(),
		productId: text("product_id").notNull(),
		status: text("status").default("granted").notNull(),
		grantedBy: uuid("granted_by"),
		grantedAt: timestamp("granted_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		revokedBy: uuid("revoked_by"),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		expiresAt: timestamp("expires_at", { withTimezone: true }),
		reason: text("reason").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.userId, table.productId] }),
		index("app_product_entitlements_user_status_idx").on(
			table.userId,
			table.status,
		),
		index("app_product_entitlements_product_status_idx").on(
			table.productId,
			table.status,
		),
		index("app_product_entitlements_expires_idx").on(table.expiresAt),
	],
);

export const appProductAccessBulkOperations = pgTable(
	"app_product_access_bulk_operations",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		idempotencyKey: text("idempotency_key").notNull().unique(),
		actorUserId: uuid("actor_user_id").notNull(),
		action: text("action").notNull(),
		productIds: jsonb("product_ids").$type<string[]>().notNull(),
		requestedUserIds: jsonb("requested_user_ids").$type<string[]>().notNull(),
		status: text("status").default("completed").notNull(),
		reason: text("reason").notNull(),
		outcome: jsonb("outcome").$type<Record<string, unknown>>().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
	},
	(table) => [
		index("app_product_access_bulk_actor_created_idx").on(
			table.actorUserId,
			table.createdAt,
		),
		index("app_product_access_bulk_status_created_idx").on(
			table.status,
			table.createdAt,
		),
	],
);

export const planEntitlements = pgTable(
	"plan_entitlements",
	{
		userId: uuid("user_id").notNull(),
		entitlementKey: text("entitlement_key").notNull(),
		status: text("status").default("active").notNull(),
		source: text("source").default("system").notNull(),
		subscriptionId: uuid("subscription_id"),
		startsAt: timestamp("starts_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }),
		metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.userId, table.entitlementKey] }),
		index("plan_entitlements_user_status_idx").on(table.userId, table.status),
		index("plan_entitlements_key_status_idx").on(
			table.entitlementKey,
			table.status,
		),
	],
);

export const subscriptions = pgTable(
	"subscriptions",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: uuid("user_id").notNull(),
		provider: text("provider").default("razorpay").notNull(),
		providerSubscriptionId: text("provider_subscription_id").notNull().unique(),
		providerPlanId: text("provider_plan_id"),
		planKey: text("plan_key").notNull(),
		status: text("status").notNull(),
		amountInr: integer("amount_inr").notNull(),
		currency: text("currency").default("INR").notNull(),
		currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
		currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
		cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
		metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("subscriptions_user_status_idx").on(
			table.userId,
			table.status,
			table.updatedAt,
		),
		uniqueIndex("subscriptions_one_open_private_server_idx")
			.on(table.userId, table.planKey)
			.where(sql`${table.status} in ('authorization_pending','authenticated','active','pending','provisioning_pending','provisioning')`),
	],
);

export const paymentEvents = pgTable(
	"payment_events",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		provider: text("provider").default("razorpay").notNull(),
		providerEventId: text("provider_event_id").notNull(),
		eventType: text("event_type").notNull(),
		signatureValid: boolean("signature_valid").default(false).notNull(),
		processedAt: timestamp("processed_at", { withTimezone: true }),
		processingStatus: text("processing_status").default("received").notNull(),
		processingError: text("processing_error"),
		payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("payment_events_provider_event_unique").on(
			table.provider,
			table.providerEventId,
		),
		index("payment_events_type_created_idx").on(
			table.eventType,
			table.createdAt,
		),
	],
);

export const donations = pgTable(
	"donations",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: uuid("user_id"),
		provider: text("provider").default("razorpay").notNull(),
		providerOrderId: text("provider_order_id").unique(),
		providerPaymentId: text("provider_payment_id").unique(),
		amountInr: integer("amount_inr").notNull(),
		currency: text("currency").default("INR").notNull(),
		status: text("status").default("created").notNull(),
		donorName: text("donor_name"),
		donorMessage: text("donor_message"),
		anonymous: boolean("anonymous").default(false).notNull(),
		receiptEmail: text("receipt_email"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		verifiedAt: timestamp("verified_at", { withTimezone: true }),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("donations_user_created_idx").on(table.userId, table.createdAt),
		index("donations_status_created_idx").on(table.status, table.createdAt),
	],
);

export const privateServerRequests = pgTable(
	"private_server_requests",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		status: text("status").default("new").notNull(),
		fullName: text("full_name").notNull(),
		email: text("email").notNull(),
		companyName: text("company_name").notNull(),
		phone: text("phone"),
		website: text("website"),
		teamSize: text("team_size"),
		monthlyWorkload: text("monthly_workload").notNull(),
		primaryUseCase: text("primary_use_case").notNull(),
		currentPlanOrUsage: text("current_plan_or_usage"),
		preferredContactMethod: text("preferred_contact_method"),
		preferredContactTime: text("preferred_contact_time"),
		technicalRequirements: text("technical_requirements"),
		message: text("message").notNull(),
		consentToContact: boolean("consent_to_contact").notNull(),
		submittedFromUrl: text("submitted_from_url"),
		userId: uuid("user_id"),
		ipHash: text("ip_hash"),
		userAgent: text("user_agent"),
		internalNotes: text("internal_notes"),
		contactedAt: timestamp("contacted_at", { withTimezone: true }),
		closedAt: timestamp("closed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("private_server_requests_status_created_idx").on(
			table.status,
			table.createdAt,
		),
		index("private_server_requests_email_created_idx").on(
			table.email,
			table.createdAt,
		),
		index("private_server_requests_user_created_idx").on(
			table.userId,
			table.createdAt,
		),
	],
);

export const dedicatedWorkerProvisioningJobs = pgTable(
	"dedicated_worker_provisioning_jobs",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: uuid("user_id").notNull(),
		subscriptionId: uuid("subscription_id"),
		state: text("state").default("pending").notNull(),
		adapter: text("adapter").default("manual").notNull(),
		workerAssignment: jsonb("worker_assignment")
			.$type<Record<string, unknown>>()
			.default({})
			.notNull(),
		attemptCount: integer("attempt_count").default(0).notNull(),
		lastError: text("last_error"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		activatedAt: timestamp("activated_at", { withTimezone: true }),
		cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
	},
	(table) => [
		index("dedicated_worker_user_state_idx").on(
			table.userId,
			table.state,
			table.updatedAt,
		),
		uniqueIndex("dedicated_worker_one_open_job_idx")
			.on(table.userId)
			.where(sql`${table.state} IN ('pending','provisioning','active')`),
	],
);

export const productEvents = pgTable(
	"product_events",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		eventName: text("event_name").notNull(),
		occurredAt: timestamp("occurred_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		userId: uuid("user_id"),
		projectId: text("project_id"),
		mediaAssetId: text("media_asset_id"),
		captionJobId: text("caption_job_id"),
		exportJobId: text("export_job_id"),
		environment: text("environment").default("production").notNull(),
		eventKey: text("event_key").notNull().unique(),
		metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("product_events_name_occurred_idx").on(
			table.eventName,
			table.occurredAt,
		),
		index("product_events_user_occurred_idx").on(table.userId, table.occurredAt),
		index("product_events_caption_job_idx").on(table.captionJobId),
		index("product_events_export_job_idx").on(table.exportJobId),
	],
);

export const adminRoles = pgTable("admin_roles", {
	id: uuid("id").defaultRandom().primaryKey(),
	key: text("key").notNull().unique(),
	name: text("name").notNull(),
	description: text("description").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
});

export const adminPermissions = pgTable("admin_permissions", {
	id: uuid("id").defaultRandom().primaryKey(),
	key: text("key").notNull().unique(),
	description: text("description").notNull(),
});

export const adminRolePermissions = pgTable(
	"admin_role_permissions",
	{
		roleId: uuid("role_id")
			.notNull()
			.references(() => adminRoles.id, { onDelete: "cascade" }),
		permissionId: uuid("permission_id")
			.notNull()
			.references(() => adminPermissions.id, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.roleId, table.permissionId] })],
);

export const adminRoleMembers = pgTable(
	"admin_role_members",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: uuid("user_id").notNull(),
		roleId: uuid("role_id")
			.notNull()
			.references(() => adminRoles.id),
		active: boolean("active").default(true).notNull(),
		assignedBy: uuid("assigned_by"),
		assignedAt: timestamp("assigned_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		revokedBy: uuid("revoked_by"),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		reason: text("reason").notNull(),
	},
	(table) => [
		index("admin_role_members_user_active_idx").on(table.userId, table.active),
		uniqueIndex("admin_role_members_active_role_idx")
			.on(table.userId, table.roleId)
			.where(sql`${table.active} = true`),
	],
);

export const captionJobs = pgTable(
	"caption_jobs",
	{
		id: text("id").primaryKey(),
		userId: uuid("user_id"),
		projectId: text("project_id"),
		sourceFilename: text("source_filename").notNull(),
		language: text("language"),
		provider: text("provider"),
		transcriptionModel: text("transcription_model"),
		transcriptionConfigVersion: integer("transcription_config_version"),
		timestampStrategy: text("timestamp_strategy"),
		providerMode: text("provider_mode"),
		mediaDurationSeconds: numeric("media_duration_seconds"),
		status: text("status").notNull(),
		progress: integer("progress").default(0).notNull(),
		wordCount: integer("word_count"),
		captionCount: integer("caption_count"),
		queuedAt: timestamp("queued_at", { withTimezone: true }),
		startedAt: timestamp("started_at", { withTimezone: true }),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
		retryCount: integer("retry_count").default(0).notNull(),
		retryOfJobId: text("retry_of_job_id"),
		adminRetryBy: uuid("admin_retry_by"),
		providerRequestId: text("provider_request_id"),
		timingSourceSummary: jsonb("timing_source_summary")
			.$type<Record<string, unknown>>()
			.default({})
			.notNull(),
		pipelineOptions: jsonb("pipeline_options")
			.$type<Record<string, unknown>>()
			.default({})
			.notNull(),
		estimatedCost: numeric("estimated_cost", { precision: 12, scale: 6 }),
		sanitizedErrorCode: text("sanitized_error_code"),
		sanitizedErrorMessage: text("sanitized_error_message"),
		diagnosticReference: text("diagnostic_reference"),
		correlationId: uuid("correlation_id"),
		...auditColumns,
	},
	(table) => [
		index("caption_jobs_user_created_idx").on(table.userId, table.createdAt),
		index("caption_jobs_status_created_idx").on(table.status, table.createdAt),
		index("caption_jobs_provider_created_idx").on(
			table.provider,
			table.createdAt,
		),
		index("caption_jobs_project_idx").on(table.projectId),
		index("caption_jobs_correlation_idx").on(table.correlationId),
	],
);

export const exportJobs = pgTable(
	"export_jobs",
	{
		id: text("id").primaryKey(),
		userId: uuid("user_id"),
		projectId: text("project_id"),
		sourceCaptionJobId: text("source_caption_job_id"),
		mode: text("mode"),
		status: text("status").notNull(),
		stage: text("stage"),
		progress: integer("progress").default(0).notNull(),
		queuePosition: integer("queue_position"),
		width: integer("width"),
		height: integer("height"),
		fps: integer("fps"),
		durationSeconds: numeric("duration_seconds"),
		outputSizeBytes: bigint("output_size_bytes", { mode: "number" }),
		renderTimeSeconds: numeric("render_time_seconds"),
		queuedAt: timestamp("queued_at", { withTimezone: true }),
		startedAt: timestamp("started_at", { withTimezone: true }),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
		retryCount: integer("retry_count").default(0).notNull(),
		retryOfExportId: text("retry_of_export_id"),
		adminRetryBy: uuid("admin_retry_by"),
		immutableInput: jsonb("immutable_input")
			.$type<Record<string, unknown>>()
			.default({})
			.notNull(),
		errorClass: text("error_class"),
		sanitizedErrorMessage: text("sanitized_error_message"),
		outputExpiry: timestamp("output_expiry", { withTimezone: true }),
		correlationId: uuid("correlation_id"),
		...auditColumns,
	},
	(table) => [
		index("export_jobs_user_created_idx").on(table.userId, table.createdAt),
		index("export_jobs_status_created_idx").on(table.status, table.createdAt),
		index("export_jobs_project_idx").on(table.projectId),
		index("export_jobs_correlation_idx").on(table.correlationId),
	],
);

export const projectRegistry = pgTable(
	"project_registry",
	{
		projectId: text("project_id").primaryKey(),
		userId: uuid("user_id"),
		name: text("name").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
		expiresAt: timestamp("expires_at", { withTimezone: true }),
		state: text("state").default("active").notNull(),
		approximateBytes: bigint("approximate_bytes", { mode: "number" }),
		mediaCount: integer("media_count").default(0).notNull(),
		captionCount: integer("caption_count").default(0).notNull(),
		captionJobCount: integer("caption_job_count").default(0).notNull(),
		exportJobCount: integer("export_job_count").default(0).notNull(),
		cleanupStatus: text("cleanup_status"),
		cleanupStartedAt: timestamp("cleanup_started_at", { withTimezone: true }),
		cleanupCompletedAt: timestamp("cleanup_completed_at", {
			withTimezone: true,
		}),
		retentionHold: boolean("retention_hold").default(false).notNull(),
		retentionHoldReason: text("retention_hold_reason"),
	},
	(table) => [
		index("project_registry_user_updated_idx").on(
			table.userId,
			table.updatedAt,
		),
		index("project_registry_expires_idx").on(table.expiresAt),
		index("project_registry_state_idx").on(table.state),
	],
);

export const deletedProjectRecords = pgTable(
	"deleted_project_records",
	{
		projectId: text("project_id").primaryKey(),
		ownerId: uuid("owner_id"),
		projectCreatedAt: timestamp("project_created_at", { withTimezone: true }),
		deletedAt: timestamp("deleted_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		sourceDurationSeconds: numeric("source_duration_seconds"),
		sourceSizeBytes: bigint("source_size_bytes", { mode: "number" }),
		captionLanguage: text("caption_language"),
		captionWordCount: integer("caption_word_count").default(0).notNull(),
		captionChunkCount: integer("caption_chunk_count").default(0).notNull(),
		captionModel: text("caption_model"),
		generationStatus: text("generation_status"),
		generationProcessingSeconds: numeric("generation_processing_seconds"),
		exportAttemptCount: integer("export_attempt_count").default(0).notNull(),
		exportFormat: text("export_format"),
		exportWidth: integer("export_width"),
		exportHeight: integer("export_height"),
		exportFps: integer("export_fps"),
		exportDurationSeconds: numeric("export_duration_seconds"),
		exportOutputSizeBytes: bigint("export_output_size_bytes", {
			mode: "number",
		}),
		exportProcessingSeconds: numeric("export_processing_seconds"),
		exportStatus: text("export_status"),
		normalizedErrorCode: text("normalized_error_code"),
		deletionStatus: text("deletion_status").default("completed").notNull(),
	},
	(table) => [
		index("deleted_project_records_owner_deleted_idx").on(
			table.ownerId,
			table.deletedAt,
		),
		index("deleted_project_records_deleted_idx").on(table.deletedAt),
	],
);

export const usageEvents = pgTable(
	"usage_events",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		eventKey: text("event_key").notNull().unique(),
		userId: uuid("user_id"),
		projectId: text("project_id"),
		eventType: text("event_type").notNull(),
		numericValue: numeric("numeric_value"),
		metadata: jsonb("metadata")
			.$type<Record<string, string | number | boolean | null>>()
			.default({})
			.notNull(),
		occurredAt: timestamp("occurred_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		correlationId: uuid("correlation_id"),
	},
	(table) => [
		index("usage_events_type_occurred_idx").on(
			table.eventType,
			table.occurredAt,
		),
		index("usage_events_user_occurred_idx").on(table.userId, table.occurredAt),
	],
);

export const usageDailyRollups = pgTable(
	"usage_daily_rollups",
	{
		day: date("date").notNull(),
		userId: uuid("user_id"),
		metric: text("metric").notNull(),
		value: numeric("value").default("0").notNull(),
	},
	(table) => [
		uniqueIndex("usage_daily_rollups_unique_idx").on(
			table.day,
			table.userId,
			table.metric,
		),
	],
);

export const providerHealthEvents = pgTable(
	"provider_health_events",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		provider: text("provider").notNull(),
		component: text("component").notNull(),
		status: text("status").notNull(),
		latencyMs: integer("latency_ms"),
		sanitizedError: text("sanitized_error"),
		checkedAt: timestamp("checked_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("provider_health_latest_idx").on(
			table.provider,
			table.component,
			table.checkedAt,
		),
	],
);

export const transcriptionConfigurations = pgTable(
	"transcription_configurations",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		provider: text("provider").notNull(),
		model: text("model").notNull(),
		providerOptions: jsonb("provider_options")
			.$type<Record<string, unknown>>()
			.default({})
			.notNull(),
		pipelineOptions: jsonb("pipeline_options")
			.$type<Record<string, unknown>>()
			.default({})
			.notNull(),
		presetId: text("preset_id"),
		presetVersion: integer("preset_version"),
		pipelineOptionSources: jsonb("pipeline_option_sources")
			.$type<Record<string, unknown>>()
			.default({})
			.notNull(),
		timestampStrategy: text("timestamp_strategy").notNull(),
		strictProvider: boolean("strict_provider").default(true).notNull(),
		status: text("status").default("draft").notNull(),
		version: integer("version").default(1).notNull(),
		testStatus: text("test_status").default("untested").notNull(),
		testedAt: timestamp("tested_at", { withTimezone: true }),
		testedBy: uuid("tested_by"),
		testErrorCode: text("test_error_code"),
		testLatencyMs: integer("test_latency_ms"),
		activatedAt: timestamp("activated_at", { withTimezone: true }),
		activatedBy: uuid("activated_by"),
		activationReason: text("activation_reason"),
		...auditColumns,
	},
	(table) => [
		index("transcription_configurations_status_idx").on(
			table.status,
			table.updatedAt,
		),
		uniqueIndex("transcription_configurations_one_active_idx")
			.on(table.status)
			.where(sql`${table.status} = 'active'`),
	],
);

export const transcriptionConfigurationVersions = pgTable(
	"transcription_configuration_versions",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		configurationId: uuid("configuration_id")
			.notNull()
			.references(() => transcriptionConfigurations.id, { onDelete: "cascade" }),
		version: integer("version").notNull(),
		action: text("action").notNull(),
		beforeSnapshot: jsonb("before_snapshot").$type<unknown>(),
		afterSnapshot: jsonb("after_snapshot").$type<unknown>().notNull(),
		reason: text("reason").notNull(),
		changedBy: uuid("changed_by"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("transcription_configuration_versions_config_idx").on(
			table.configurationId,
			table.version,
			table.createdAt,
		),
	],
);

export const featureFlags = pgTable("feature_flags", {
	key: text("key").primaryKey(),
	description: text("description").notNull(),
	enabled: boolean("enabled").default(false).notNull(),
	scope: text("scope").default("global").notNull(),
	configuration: jsonb("configuration")
		.$type<Record<string, unknown>>()
		.default({})
		.notNull(),
	updatedBy: uuid("updated_by"),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
	version: integer("version").default(1).notNull(),
});

export const featureFlagVersions = pgTable(
	"feature_flag_versions",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		key: text("key").notNull(),
		enabled: boolean("enabled").notNull(),
		configuration: jsonb("configuration")
			.$type<Record<string, unknown>>()
			.notNull(),
		version: integer("version").notNull(),
		changedBy: uuid("changed_by"),
		reason: text("reason").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("feature_flag_versions_key_version_idx").on(table.key, table.version),
	],
);

export const systemSettings = pgTable("system_settings", {
	key: text("key").primaryKey(),
	value: jsonb("value").$type<unknown>().notNull(),
	description: text("description").notNull(),
	updatedBy: uuid("updated_by"),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
});

export const userQuotas = pgTable("user_quotas", {
	userId: uuid("user_id").primaryKey(),
	dailyCaptionMinutes: integer("daily_caption_minutes")
		.default(60)
		.notNull(),
	dailyExportMinutes: integer("daily_export_minutes").default(60).notNull(),
	maxUploadDurationSeconds: integer("max_upload_duration_seconds")
		.default(1800)
		.notNull(),
	maxConcurrentCaptionJobs: integer("max_concurrent_caption_jobs")
		.default(2)
		.notNull(),
	maxConcurrentExportJobs: integer("max_concurrent_export_jobs")
		.default(1)
		.notNull(),
	updatedBy: uuid("updated_by"),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
});

export const supportCases = pgTable(
	"support_cases",
	{
		id: text("id").primaryKey(),
		userId: uuid("user_id"),
		emailSnapshot: text("email_snapshot"),
		category: text("category").default("general").notNull(),
		status: text("status").default("new").notNull(),
		priority: text("priority").default("normal").notNull(),
		assigneeUserId: uuid("assignee_user_id"),
		message: text("message").notNull(),
		internalNotes: text("internal_notes"),
		page: text("page"),
		feature: text("feature"),
		browser: text("browser"),
		appVersion: text("app_version"),
		projectId: text("project_id"),
		captionJobId: text("caption_job_id"),
		exportJobId: text("export_job_id"),
		resolution: text("resolution"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		resolvedAt: timestamp("resolved_at", { withTimezone: true }),
	},
	(table) => [
		index("support_cases_status_priority_idx").on(
			table.status,
			table.priority,
			table.createdAt,
		),
		index("support_cases_assignee_idx").on(
			table.assigneeUserId,
			table.updatedAt,
		),
		index("support_cases_user_idx").on(table.userId, table.createdAt),
	],
);

export const supportCaseEvents = pgTable(
	"support_case_events",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		caseId: text("case_id")
			.notNull()
			.references(() => supportCases.id, { onDelete: "cascade" }),
		adminUserId: uuid("admin_user_id"),
		action: text("action").notNull(),
		beforeValue: jsonb("before_value").$type<unknown>(),
		afterValue: jsonb("after_value").$type<unknown>(),
		note: text("note"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("support_case_events_case_created_idx").on(
			table.caseId,
			table.createdAt,
		),
	],
);

// Kept for backwards compatibility. New submissions are mirrored into support_cases.
export const feedback = pgTable("feedback", {
	id: text("id").primaryKey(),
	message: text("message").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
});

export const adminAuditLog = pgTable(
	"admin_audit_log",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		adminUserId: uuid("admin_user_id"),
		action: text("action").notNull(),
		targetType: text("target_type"),
		targetId: text("target_id"),
		reason: text("reason"),
		beforeValue: jsonb("before_value").$type<unknown>(),
		afterValue: jsonb("after_value").$type<unknown>(),
		requestId: uuid("request_id").notNull(),
		correlationId: uuid("correlation_id").notNull(),
		sessionFingerprint: text("session_fingerprint"),
		ipRepresentation: text("ip_representation"),
		userAgentSummary: text("user_agent_summary"),
		success: boolean("success").notNull(),
		failureCode: text("failure_code"),
		severity: text("severity").default("info").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("admin_audit_actor_created_idx").on(
			table.adminUserId,
			table.createdAt,
		),
		index("admin_audit_action_created_idx").on(table.action, table.createdAt),
		index("admin_audit_target_idx").on(table.targetType, table.targetId),
		index("admin_audit_correlation_idx").on(table.correlationId),
	],
);

export const adminSecurityEvents = pgTable(
	"admin_security_events",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		eventType: text("event_type").notNull(),
		ipHash: text("ip_hash"),
		protectedIp: text("protected_ip"),
		emailHash: text("email_hash"),
		attemptCount: integer("attempt_count").default(1).notNull(),
		severity: text("severity").default("medium").notNull(),
		blockedUntil: timestamp("blocked_until", { withTimezone: true }),
		resolvedAt: timestamp("resolved_at", { withTimezone: true }),
		resolvedBy: uuid("resolved_by"),
		resolutionReason: text("resolution_reason"),
		metadata: jsonb("metadata")
			.$type<Record<string, string | number | boolean | null>>()
			.default({})
			.notNull(),
		...auditColumns,
	},
	(table) => [
		index("admin_security_active_blocks_idx").on(
			table.blockedUntil,
			table.resolvedAt,
		),
		index("admin_security_type_created_idx").on(
			table.eventType,
			table.createdAt,
		),
		index("admin_security_ip_hash_idx").on(table.ipHash),
	],
);

export const adminFreshMfa = pgTable(
	"admin_fresh_mfa",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		adminUserId: uuid("admin_user_id").notNull(),
		sessionId: uuid("session_id").notNull(),
		verifiedAt: timestamp("verified_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	},
	(table) => [
		uniqueIndex("admin_fresh_mfa_session_idx").on(
			table.adminUserId,
			table.sessionId,
		),
		index("admin_fresh_mfa_expires_idx").on(table.expiresAt),
	],
);
