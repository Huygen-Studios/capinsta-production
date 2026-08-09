import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
	adminAuditLog,
	appProductAccessBulkOperations,
	appProductEntitlements,
	appUserPermissionOverrides,
	appPermissions,
	profiles,
} from "@/db/schema";
import type { AdminContext } from "./auth";
import { adminSessionFingerprint } from "./auth";
import { getAdminRequestMetadata } from "./request";
import type { AppPermission } from "@/access/permissions";

export const PRODUCT_CATALOG = [
	{
		id: "editor",
		name: "Editor",
		description: "Projects, uploads, caption generation, editor UI, and render preview.",
		permissions: ["app.access", "projects.access", "editor.access", "render.access"],
	},
	{
		id: "exports",
		name: "Exports",
		description: "Captioned video export jobs and export downloads.",
		permissions: ["exports.access"],
	},
] as const;

export type ProductId = (typeof PRODUCT_CATALOG)[number]["id"];
export type ProductAccessAction = "grant" | "revoke" | "replace";
export type ProductEffectiveState =
	| "Granted"
	| "Not Granted"
	| "Inherited"
	| "Expired"
	| "Disabled";

export const PRODUCT_IDS = PRODUCT_CATALOG.map((product) => product.id);
type DbExecutor = Pick<typeof db, "select" | "insert" | "update" | "execute">;

export function isMissingProductEntitlementsTableError(error: unknown) {
	if (!error || typeof error !== "object") return false;
	const record = error as { code?: unknown; message?: unknown };
	return (
		record.code === "42P01" &&
		typeof record.message === "string" &&
		record.message.includes("app_product_entitlements")
	);
}

export function isProductId(value: string): value is ProductId {
	return (PRODUCT_IDS as readonly string[]).includes(value);
}

export function permissionsForProducts(productIds: readonly string[]) {
	const permissions = new Set<AppPermission>();
	for (const productId of productIds) {
		const product = PRODUCT_CATALOG.find((item) => item.id === productId);
		if (!product) continue;
		for (const permission of product.permissions) {
			permissions.add(permission as AppPermission);
		}
	}
	return permissions;
}

export function productIdsForPermission(permission: AppPermission) {
	return PRODUCT_CATALOG.filter((product) =>
		(product.permissions as readonly string[]).includes(permission),
	).map((product) => product.id);
}

export type ProductAccessView = {
	userId: string;
	accountStatus: string;
	productAccessStatus: string;
	productAccessExpiresAt: string | null;
	products: Array<{
		id: ProductId;
		name: string;
		description: string;
		state: ProductEffectiveState;
		entitlementStatus: string | null;
		expiresAt: string | null;
		source: "direct" | "role_or_permission" | "none" | "profile";
	}>;
};

function iso(value: Date | null | undefined) {
	return value ? value.toISOString() : null;
}

function validateProductIds(productIds: readonly string[]) {
	const unique = [...new Set(productIds)];
	if (unique.length === 0) throw new Error("no_products_selected");
	for (const productId of unique) {
		if (!isProductId(productId)) throw new Error("invalid_product_id");
	}
	return unique as ProductId[];
}

function validateUserIds(userIds: readonly string[]) {
	const unique = [...new Set(userIds)];
	if (unique.length === 0) throw new Error("no_users_selected");
	if (unique.length > 250) throw new Error("bulk_user_limit_exceeded");
	for (const userId of unique) {
		if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
			throw new Error("invalid_user_id");
		}
	}
	return unique;
}

export async function directProductRevocationsForUser(userId: string) {
	let rows: Array<{ productId: string; expiresAt: Date | null }> = [];
	try {
		rows = await db
			.select({
				productId: appProductEntitlements.productId,
				expiresAt: appProductEntitlements.expiresAt,
			})
			.from(appProductEntitlements)
			.where(
				and(
					eq(appProductEntitlements.userId, userId),
					eq(appProductEntitlements.status, "revoked"),
				),
			);
	} catch (error) {
		if (!isMissingProductEntitlementsTableError(error)) throw error;
		console.error(JSON.stringify({
			event: "product_access_entitlements_missing",
			code: "app_product_entitlements_missing",
			operation: "direct_revocations_for_user",
		}));
	}
	const now = new Date();
	return new Set(
		rows
			.filter((row) => !row.expiresAt || row.expiresAt > now)
			.map((row) => row.productId),
	);
}

export async function directProductGrantsForUser(userId: string) {
	let rows: Array<{ productId: string; expiresAt: Date | null }> = [];
	try {
		rows = await db
			.select({
				productId: appProductEntitlements.productId,
				expiresAt: appProductEntitlements.expiresAt,
			})
			.from(appProductEntitlements)
			.where(
				and(
					eq(appProductEntitlements.userId, userId),
					eq(appProductEntitlements.status, "granted"),
				),
			);
	} catch (error) {
		if (!isMissingProductEntitlementsTableError(error)) throw error;
		console.error(JSON.stringify({
			event: "product_access_entitlements_missing",
			code: "app_product_entitlements_missing",
			operation: "direct_grants_for_user",
		}));
	}
	const now = new Date();
	return rows
		.filter((row) => !row.expiresAt || row.expiresAt > now)
		.map((row) => row.productId);
}

export async function getUserProductAccess(userId: string): Promise<ProductAccessView> {
	const [profile] = await db
		.select({
			userId: profiles.userId,
			accountStatus: profiles.accountStatus,
			productAccessStatus: profiles.productAccessStatus,
			productAccessExpiresAt: profiles.productAccessExpiresAt,
		})
		.from(profiles)
		.where(eq(profiles.userId, userId))
		.limit(1);
	if (!profile) throw new Error("target_not_found");

	const [entitlements, overrideRows] = await Promise.all([
		db
			.select()
			.from(appProductEntitlements)
			.where(eq(appProductEntitlements.userId, userId)),
		db
			.select({ key: appPermissions.key, effect: appUserPermissionOverrides.effect })
			.from(appUserPermissionOverrides)
			.innerJoin(
				appPermissions,
				eq(appPermissions.id, appUserPermissionOverrides.permissionId),
			)
			.where(
				and(
					eq(appUserPermissionOverrides.userId, userId),
					eq(appUserPermissionOverrides.active, true),
				),
			),
	]);
	const now = new Date();
	const entitlementByProduct = new Map(
		entitlements.map((row) => [row.productId, row]),
	);
	const allowedOverrides = new Set(
		overrideRows
			.filter((row) => row.effect === "allow")
			.map((row) => row.key),
	);
	const profileDisabled =
		profile.accountStatus !== "active" ||
		profile.productAccessStatus === "revoked" ||
		Boolean(profile.productAccessExpiresAt && profile.productAccessExpiresAt <= now);

	return {
		userId,
		accountStatus: profile.accountStatus,
		productAccessStatus: profile.productAccessStatus,
		productAccessExpiresAt: iso(profile.productAccessExpiresAt),
		products: PRODUCT_CATALOG.map((product) => {
			const entitlement = entitlementByProduct.get(product.id);
			const inherited = product.permissions.some((permission) =>
				allowedOverrides.has(permission),
			);
			const expired = Boolean(
				entitlement?.expiresAt && entitlement.expiresAt <= now,
			);
			const state: ProductEffectiveState = profileDisabled
				? "Disabled"
				: expired
					? "Expired"
					: entitlement?.status === "granted"
						? "Granted"
						: inherited
							? "Inherited"
							: "Not Granted";
			return {
				id: product.id,
				name: product.name,
				description: product.description,
				state,
				entitlementStatus: entitlement?.status ?? null,
				expiresAt: iso(entitlement?.expiresAt),
				source: profileDisabled
					? "profile"
					: entitlement?.status === "granted"
						? "direct"
						: inherited
							? "role_or_permission"
							: "none",
			};
		}),
	};
}

async function auditEntitlementChange({
	tx,
	context,
	targetUserId,
	productId,
	action,
	reason,
	before,
	after,
	bulkOperationId,
}: {
	tx: DbExecutor;
	context: AdminContext;
	targetUserId: string;
	productId: string;
	action: string;
	reason: string;
	before: unknown;
	after: unknown;
	bulkOperationId?: string;
}) {
	const request = await getAdminRequestMetadata();
	await tx.insert(adminAuditLog).values({
		adminUserId: context.userId,
		action,
		targetType: "product_access",
		targetId: targetUserId,
		reason,
		beforeValue: before,
		afterValue: { productId, entitlement: after, bulkOperationId },
		requestId: request.requestId,
		correlationId: request.correlationId,
		sessionFingerprint: adminSessionFingerprint(context),
		ipRepresentation: request.ipHash.slice(0, 24),
		userAgentSummary: request.userAgent.slice(0, 120),
		success: true,
		severity: "high",
	});
}

async function upsertEntitlement({
	tx,
	context,
	userId,
	productId,
	status,
	reason,
	bulkOperationId,
}: {
	tx: DbExecutor;
	context: AdminContext;
	userId: string;
	productId: ProductId;
	status: "granted" | "revoked";
	reason: string;
	bulkOperationId?: string;
}) {
	const [before] = await tx
		.select()
		.from(appProductEntitlements)
		.where(
			and(
				eq(appProductEntitlements.userId, userId),
				eq(appProductEntitlements.productId, productId),
			),
		)
		.limit(1);
	const values = {
		userId,
		productId,
		status,
		grantedBy: status === "granted" ? context.userId : before?.grantedBy ?? context.userId,
		grantedAt: status === "granted" ? new Date() : before?.grantedAt ?? new Date(),
		revokedBy: status === "revoked" ? context.userId : null,
		revokedAt: status === "revoked" ? new Date() : null,
		reason,
		updatedAt: new Date(),
	};
	const [after] = await tx
		.insert(appProductEntitlements)
		.values(values)
		.onConflictDoUpdate({
			target: [appProductEntitlements.userId, appProductEntitlements.productId],
			set: values,
		})
		.returning();
	if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) {
		await auditEntitlementChange({
			tx,
			context,
			targetUserId: userId,
			productId,
			action: `product_access.${status === "granted" ? "grant" : "revoke"}`,
			reason,
			before: before ?? null,
			after,
			bulkOperationId,
		});
		return "changed";
	}
	return "unchanged";
}

async function updateProfileAccessGate({
	tx,
	userId,
	context,
	status,
	reason,
}: {
	tx: DbExecutor;
	userId: string;
	context: AdminContext;
	status: "approved" | "revoked";
	reason: string;
}) {
	await tx
		.update(profiles)
		.set({
			productAccessStatus: status,
			productAccessApprovedAt: status === "approved" ? new Date() : undefined,
			productAccessExpiresAt: status === "approved" ? null : undefined,
			productAccessUpdatedAt: new Date(),
			productAccessUpdatedBy: context.userId,
			productAccessReason: reason,
			updatedAt: new Date(),
		})
		.where(eq(profiles.userId, userId));
}

export async function applyProductAccessForUser({
	userId,
	productIds,
	action,
	reason,
	context,
}: {
	userId: string;
	productIds: readonly string[];
	action: ProductAccessAction;
	reason: string;
	context: AdminContext;
}) {
	const validProducts = validateProductIds(productIds);
	if (userId === context.userId) throw new Error("self_access_change_denied");
	const result = await db.transaction(async (tx) => {
		const [profile] = await tx
			.select()
			.from(profiles)
			.where(eq(profiles.userId, userId))
			.limit(1);
		if (!profile) throw new Error("target_not_found");
		if (profile.accountStatus !== "active") throw new Error("target_ineligible");
		const productsToRevoke =
			action === "replace"
				? PRODUCT_CATALOG.filter((product) => !validProducts.includes(product.id)).map(
						(product) => product.id,
					)
				: action === "revoke"
					? validProducts
					: [];
		let changed = 0;
		let unchanged = 0;
		for (const productId of validProducts) {
			if (action === "revoke") continue;
			const outcome = await upsertEntitlement({
				tx,
				context,
				userId,
				productId,
				status: "granted",
				reason,
			});
			if (outcome === "changed") changed += 1;
			else unchanged += 1;
		}
		for (const productId of productsToRevoke) {
			const outcome = await upsertEntitlement({
				tx,
				context,
				userId,
				productId,
				status: "revoked",
				reason,
			});
			if (outcome === "changed") changed += 1;
			else unchanged += 1;
		}
		await updateProfileAccessGate({
			tx,
			userId,
			context,
			status: action === "revoke" && validProducts.length === PRODUCT_CATALOG.length ? "revoked" : "approved",
			reason,
		});
		return { changed, unchanged };
	});
	return result;
}

export type BulkProductAccessOutcome = {
	operationId: string | null;
	action: ProductAccessAction;
	productIds: ProductId[];
	totalUsers: number;
	successfulUsers: number;
	changedEntitlements: number;
	unchangedEntitlements: number;
	skipped: Array<{ userId: string; reason: string }>;
	failures: Array<{ userId: string; reason: string }>;
};

export async function previewBulkProductAccess({
	userIds,
	productIds,
	action,
}: {
	userIds: readonly string[];
	productIds: readonly string[];
	action: ProductAccessAction;
}): Promise<BulkProductAccessOutcome> {
	const validUsers = validateUserIds(userIds);
	const validProducts = validateProductIds(productIds);
	const rows = await db
		.select({
			userId: profiles.userId,
			accountStatus: profiles.accountStatus,
			productAccessStatus: profiles.productAccessStatus,
		})
		.from(profiles)
		.where(inArray(profiles.userId, validUsers));
	const found = new Set(rows.map((row) => row.userId));
	const skipped = validUsers
		.filter((userId) => !found.has(userId))
		.map((userId) => ({ userId, reason: "not_found" }));
	for (const row of rows) {
		if (row.accountStatus !== "active") {
			skipped.push({ userId: row.userId, reason: "ineligible_account_state" });
		}
	}
	const eligible = rows.filter((row) => row.accountStatus === "active");
	return {
		operationId: null,
		action,
		productIds: validProducts,
		totalUsers: validUsers.length,
		successfulUsers: eligible.length,
		changedEntitlements: 0,
		unchangedEntitlements: 0,
		skipped,
		failures: [],
	};
}

export async function applyBulkProductAccess({
	userIds,
	productIds,
	action,
	reason,
	context,
	idempotencyKey,
}: {
	userIds: readonly string[];
	productIds: readonly string[];
	action: ProductAccessAction;
	reason: string;
	context: AdminContext;
	idempotencyKey: string;
}): Promise<BulkProductAccessOutcome> {
	if (!idempotencyKey || idempotencyKey.length > 160)
		throw new Error("invalid_idempotency_key");
	const validUsers = validateUserIds(userIds).filter((id) => id !== context.userId);
	const validProducts = validateProductIds(productIds);
	return await db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(appProductAccessBulkOperations)
			.where(eq(appProductAccessBulkOperations.idempotencyKey, idempotencyKey))
			.limit(1);
		if (existing) {
			return existing.outcome as BulkProductAccessOutcome;
		}
		const rows = await tx
			.select({
				userId: profiles.userId,
				accountStatus: profiles.accountStatus,
				productAccessStatus: profiles.productAccessStatus,
			})
			.from(profiles)
			.where(inArray(profiles.userId, validUsers));
		const found = new Set(rows.map((row) => row.userId));
		const skipped = validUsers
			.filter((userId) => !found.has(userId))
			.map((userId) => ({ userId, reason: "not_found" }));
		let changedEntitlements = 0;
		let unchangedEntitlements = 0;
		let successfulUsers = 0;
		const failures: Array<{ userId: string; reason: string }> = [];
		const [operation] = await tx
			.insert(appProductAccessBulkOperations)
			.values({
				idempotencyKey,
				actorUserId: context.userId,
				action,
				productIds: validProducts,
				requestedUserIds: validUsers,
				status: "running",
				reason,
				outcome: {},
			})
			.returning();
		for (const row of rows) {
			if (row.accountStatus !== "active") {
				skipped.push({ userId: row.userId, reason: "ineligible_account_state" });
				continue;
			}
			try {
				const toGrant = action === "revoke" ? [] : validProducts;
				const toRevoke =
					action === "replace"
						? PRODUCT_CATALOG.filter((product) => !validProducts.includes(product.id)).map(
								(product) => product.id,
							)
						: action === "revoke"
							? validProducts
							: [];
				for (const productId of toGrant) {
					const result = await upsertEntitlement({
						tx,
						context,
						userId: row.userId,
						productId,
						status: "granted",
						reason,
						bulkOperationId: operation.id,
					});
					if (result === "changed") changedEntitlements += 1;
					else unchangedEntitlements += 1;
				}
				for (const productId of toRevoke) {
					const result = await upsertEntitlement({
						tx,
						context,
						userId: row.userId,
						productId,
						status: "revoked",
						reason,
						bulkOperationId: operation.id,
					});
					if (result === "changed") changedEntitlements += 1;
					else unchangedEntitlements += 1;
				}
				await updateProfileAccessGate({
					tx,
					userId: row.userId,
					context,
					status: "approved",
					reason,
				});
				successfulUsers += 1;
			} catch (error) {
				failures.push({
					userId: row.userId,
					reason: error instanceof Error ? error.message : "failed",
				});
				throw error;
			}
		}
		const outcome: BulkProductAccessOutcome = {
			operationId: operation.id,
			action,
			productIds: validProducts,
			totalUsers: validUsers.length,
			successfulUsers,
			changedEntitlements,
			unchangedEntitlements,
			skipped,
			failures,
		};
		await tx
			.update(appProductAccessBulkOperations)
			.set({
				status: "completed",
				completedAt: new Date(),
				outcome,
			})
			.where(eq(appProductAccessBulkOperations.id, operation.id));
		await tx.execute(sql`select 1`);
		return outcome;
	});
}
