import type { AppPermission, ProductAccessStatus, SiteAccessMode } from "./permissions";

export const PRODUCT_CAPABILITY_PERMISSIONS = [
	"projects.access",
	"editor.access",
	"exports.access",
	"render.access",
] as const satisfies readonly AppPermission[];

const productCapabilityPermissions = new Set<AppPermission>(
	PRODUCT_CAPABILITY_PERMISSIONS,
);

export type AccessDenialCode =
	| "unauthenticated"
	| "account_inactive"
	| "product_access_revoked"
	| "product_access_expired"
	| "maintenance_mode"
	| "product_access_pending"
	| "insufficient_product_permission";

export type AccessDecisionContext = {
	accountStatus: string;
	productAccessStatus: ProductAccessStatus;
	productAccessExpired: boolean;
	permissions: ReadonlySet<AppPermission>;
	isSuperAdmin: boolean;
	sitePolicy: { mode: SiteAccessMode };
};

export function requiresApprovedProductAccess(permission: AppPermission) {
	return productCapabilityPermissions.has(permission);
}

export function accessDenialForContext(
	context: AccessDecisionContext | null,
	permission: AppPermission,
): { status: number; code: AccessDenialCode } | null {
	if (!context) return { status: 401, code: "unauthenticated" };
	if (context.accountStatus !== "active")
		return { status: 403, code: "account_inactive" };
	if (context.productAccessStatus === "revoked")
		return { status: 403, code: "product_access_revoked" };
	if (context.productAccessExpired)
		return { status: 403, code: "product_access_expired" };
	if (context.isSuperAdmin) return null;
	if (
		context.sitePolicy.mode === "maintenance" &&
		!context.permissions.has("maintenance.bypass")
	)
		return { status: 503, code: "maintenance_mode" };

	if (requiresApprovedProductAccess(permission)) {
		if (context.productAccessStatus !== "approved")
			return { status: 403, code: "product_access_pending" };
		if (!context.permissions.has(permission))
			return { status: 403, code: "insufficient_product_permission" };
		return null;
	}

	if (
		context.sitePolicy.mode === "coming_soon" &&
		context.productAccessStatus !== "approved" &&
		!context.permissions.has("app.access")
	)
		return { status: 403, code: "product_access_pending" };
	if (
		context.sitePolicy.mode !== "public" &&
		context.productAccessStatus !== "approved" &&
		!context.permissions.has(permission)
	)
		return { status: 403, code: "product_access_pending" };
	if (
		context.sitePolicy.mode !== "public" &&
		context.productAccessStatus === "approved" &&
		!context.permissions.has(permission)
	)
		return { status: 403, code: "insufficient_product_permission" };
	if (
		context.sitePolicy.mode === "public" &&
		!context.permissions.has(permission) &&
		permission !== "app.access"
	)
		return { status: 403, code: "insufficient_product_permission" };
	return null;
}
