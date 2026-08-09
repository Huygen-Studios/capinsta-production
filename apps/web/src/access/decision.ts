import type { AppPermission, ProductAccessStatus, SiteAccessMode } from "./permissions";
/* eslint-disable opencut/prefer-object-params -- compatibility wrappers mirror the established authorization call sites. */

export const PRODUCT_CAPABILITIES = [
	"open_editor",
	"create_project",
	"import_media",
	"run_transcription",
	"generate_captions",
	"start_export",
	"download_export",
	"use_product_api",
] as const;

export type ProductCapability = (typeof PRODUCT_CAPABILITIES)[number];

export const PRODUCT_CAPABILITY_PERMISSIONS = [
	"projects.access",
	"editor.access",
	"exports.access",
	"render.access",
] as const satisfies readonly AppPermission[];

export type ProductAccessReasonCode =
	| "allowed_public"
	| "allowed_entitlement"
	| "allowed_admin"
	| "allowed_maintenance_bypass"
	| "denied_banned"
	| "denied_suspended"
	| "denied_disabled"
	| "denied_security_blocked"
	| "denied_restricted"
	| "denied_coming_soon"
	| "denied_maintenance"
	| "denied_expired_entitlement"
	| "denied_missing_entitlement"
	| "denied_missing_session";

export type ProductAccessDecision = {
	allowed: boolean;
	reasonCode: ProductAccessReasonCode;
	userMessage: string;
	effectiveLaunchMode: SiteAccessMode;
	restrictionApplied: string | null;
	entitlementApplied: string | null;
};

export type ProductAccessEvaluation = {
	launchMode: SiteAccessMode;
	user: null | {
		accountStatus: string;
		isAdmin: boolean;
		isSuperAdmin: boolean;
		hasMaintenanceBypass: boolean;
	};
	entitlement: {
		status: ProductAccessStatus | "missing";
		expired: boolean;
		hasCapabilityGrant: boolean;
		hasCapabilityRevocation: boolean;
	};
	restriction: string | null;
	requestedCapability: ProductCapability;
};

const messages: Record<ProductAccessReasonCode, string> = {
	allowed_public: "Product access is available.",
	allowed_entitlement: "Your account has product access.",
	allowed_admin: "Administrator product access is available.",
	allowed_maintenance_bypass: "Maintenance operator access is available.",
	denied_banned: "Your product access has been restricted.",
	denied_suspended: "Your account is temporarily suspended.",
	denied_disabled: "Your product access has been restricted.",
	denied_security_blocked: "Your product access has been restricted.",
	denied_restricted: "Your product access has been restricted.",
	denied_coming_soon: "Your account is waiting for early access.",
	denied_maintenance: "CapInsta is temporarily under maintenance.",
	denied_expired_entitlement: "Your product access has expired.",
	denied_missing_entitlement: "Your account is waiting for early access.",
	denied_missing_session: "Sign in to continue.",
};

function decision(
	input: ProductAccessEvaluation,
	allowed: boolean,
	reasonCode: ProductAccessReasonCode,
	restrictionApplied: string | null = null,
	entitlementApplied: string | null = null,
): ProductAccessDecision {
	return {
		allowed,
		reasonCode,
		userMessage: messages[reasonCode],
		effectiveLaunchMode: input.launchMode,
		restrictionApplied,
		entitlementApplied,
	};
}

/** The single policy table for every page, API, and background-job capability. */
export function evaluateProductAccess(
	input: ProductAccessEvaluation,
): ProductAccessDecision {
	if (!input.user) return decision(input, false, "denied_missing_session");

	// Super administrators retain operational access. Their actions are audited at
	// the mutation/job boundary; access alone never suppresses audit recording.
	if (input.user.isSuperAdmin)
		return decision(input, true, "allowed_admin", null, "super_admin");

	const restriction = input.restriction ??
		(input.entitlement.hasCapabilityRevocation ? "product_revoked" : null) ??
		(input.entitlement.status === "revoked" ? "product_revoked" : null) ??
		(input.user.accountStatus !== "active" ? input.user.accountStatus : null);
	if (restriction) {
		const code: ProductAccessReasonCode =
			restriction === "banned" ? "denied_banned" :
			restriction === "suspended" ? "denied_suspended" :
			restriction === "disabled" || restriction === "deleted" || restriction === "deletion_scheduled" ? "denied_disabled" :
			restriction === "security_blocked" ? "denied_security_blocked" :
			"denied_restricted";
		return decision(input, false, code, restriction);
	}

	if (input.launchMode === "maintenance") {
		if (input.user.isAdmin)
			return decision(input, true, "allowed_admin", null, "administrator");
		if (input.user.hasMaintenanceBypass)
			return decision(input, true, "allowed_maintenance_bypass", null, "maintenance.bypass");
		return decision(input, false, "denied_maintenance");
	}

	if (input.launchMode === "public")
		return decision(input, true, "allowed_public", null, "public_default");

	if (input.user.isAdmin)
		return decision(input, true, "allowed_admin", null, "administrator");
	if (input.entitlement.expired)
		return decision(input, false, "denied_expired_entitlement", null, "expired");
	if (input.entitlement.hasCapabilityGrant || input.entitlement.status === "approved")
		return decision(input, true, "allowed_entitlement", null,
			input.entitlement.hasCapabilityGrant ? "explicit_grant" : "legacy_profile_approval");
	return decision(input, false,
		input.entitlement.status === "missing" ? "denied_missing_entitlement" : "denied_coming_soon");
}

export type AccessDenialCode = ProductAccessReasonCode;

export type AccessDecisionContext = {
	accountStatus: string;
	productAccessStatus: ProductAccessStatus;
	productAccessExpired: boolean;
	permissions: ReadonlySet<AppPermission>;
	explicitGrantPermissions?: ReadonlySet<AppPermission>;
	explicitRevocationPermissions?: ReadonlySet<AppPermission>;
	isAdmin?: boolean;
	isSuperAdmin: boolean;
	sitePolicy: { mode: SiteAccessMode };
};

export function requiresApprovedProductAccess(permission: AppPermission) {
	return (PRODUCT_CAPABILITY_PERMISSIONS as readonly AppPermission[]).includes(permission);
}

export function capabilityForPermission(permission: AppPermission): ProductCapability {
	if (permission === "projects.access") return "create_project";
	if (permission === "exports.access") return "start_export";
	if (permission === "render.access") return "download_export";
	if (permission === "editor.access") return "open_editor";
	return "use_product_api";
}

export function accessDecisionForContext(
	context: AccessDecisionContext | null,
	permission: AppPermission,
): ProductAccessDecision {
	const mode = context?.sitePolicy.mode ?? "public";
	return evaluateProductAccess({
		launchMode: mode,
		user: context ? {
			accountStatus: context.accountStatus,
			isAdmin: context.isAdmin ?? context.isSuperAdmin,
			isSuperAdmin: context.isSuperAdmin,
			hasMaintenanceBypass: context.permissions.has("maintenance.bypass"),
		} : null,
		entitlement: {
			status: context?.productAccessStatus ?? "missing",
			expired: context?.productAccessExpired ?? false,
			hasCapabilityGrant: context?.explicitGrantPermissions?.has(permission) ?? false,
			hasCapabilityRevocation: context?.explicitRevocationPermissions?.has(permission) ?? false,
		},
		restriction: null,
		requestedCapability: capabilityForPermission(permission),
	});
}

export function accessDenialForContext(
	context: AccessDecisionContext | null,
	permission: AppPermission,
): { status: number; code: AccessDenialCode; decision: ProductAccessDecision } | null {
	const result = accessDecisionForContext(context, permission);
	if (result.allowed) return null;
	const status = result.reasonCode === "denied_missing_session" ? 401 :
		result.reasonCode === "denied_maintenance" ? 503 : 403;
	return { status, code: result.reasonCode, decision: result };
}
