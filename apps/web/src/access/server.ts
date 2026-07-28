import "server-only";

/* eslint-disable opencut/prefer-object-params -- Authorization guard call sites read better with permission/path pairs. */
import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { unstable_cache as nextCache, revalidateTag } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getCurrentAdminContext } from "@/admin/auth";
import {
	directProductGrantsForUser,
	directProductRevocationsForUser,
	permissionsForProducts,
} from "@/admin/product-access";
import { isUiTestAuthBypassEnabled, signInPathFor } from "@/auth/routes";
import { db } from "@/db";
import {
	appPermissions,
	appRoleMembers,
	appRolePermissions,
	appRoles,
	appUserPermissionOverrides,
	profiles,
	siteAccessPolicy,
} from "@/db/schema";
import { createClient } from "@/lib/supabase/server";
import { accessDenialForContext } from "./decision";
import {
	type AppPermission,
	isAppPermission,
	isProductAccessStatus,
	isSiteAccessMode,
} from "./permissions";
import type { ProductAccessStatus, SiteAccessMode } from "./permissions";

export const SITE_ACCESS_POLICY_CACHE_TAG = "site-access-policy";

export type SitePolicy = {
	mode: SiteAccessMode;
	allowSignups: boolean;
	comingSoonMessage: string;
	maintenanceMessage: string;
	version: number;
	updatedBy: string | null;
	updatedAt: Date;
};

export type AccessContext = {
	userId: string;
	email: string | null;
	accountStatus: string;
	productAccessStatus: ProductAccessStatus;
	productAccessExpired: boolean;
	productAccessExpiresAt: Date | null;
	emailConfirmedAt: Date | null;
	lastAuthenticatedAt: Date | null;
	authProviderSnapshot: string | null;
	permissions: Set<AppPermission>;
	explicitGrantPermissions: Set<AppPermission>;
	explicitRevocationPermissions: Set<AppPermission>;
	roleKeys: string[];
	isAdmin: boolean;
	isSuperAdmin: boolean;
	sitePolicy: SitePolicy;
};

const defaultPolicy: SitePolicy = {
	mode: "public",
	allowSignups: true,
	comingSoonMessage:
		"Create your Capinsta account to join the private beta. We're inviting creators and editors in small groups while we improve timing, editing and export reliability.",
	maintenanceMessage:
		"We're making improvements to the application. Your account and projects remain safe.",
	version: 1,
	updatedBy: null,
	updatedAt: new Date(0),
};

const loadSiteAccessPolicy = nextCache(
	async (): Promise<SitePolicy> => {
		const [policy] = await db
			.select()
			.from(siteAccessPolicy)
			.where(eq(siteAccessPolicy.id, "global"))
			.limit(1);
		if (!policy) return defaultPolicy;
		const mode = isSiteAccessMode(policy.mode) ? policy.mode : "public";
		return {
			mode,
			allowSignups: policy.allowSignups,
			comingSoonMessage: policy.comingSoonMessage,
			maintenanceMessage: policy.maintenanceMessage,
			version: policy.version,
			updatedBy: policy.updatedBy,
			updatedAt: policy.updatedAt,
		};
	},
	["site-access-policy-v1"],
	{ revalidate: 15, tags: [SITE_ACCESS_POLICY_CACHE_TAG] },
);

export async function getSiteAccessPolicy() {
	if (isUiTestAuthBypassEnabled()) return defaultPolicy;
	return loadSiteAccessPolicy();
}

export function invalidateSiteAccessPolicy() {
	revalidateTag(SITE_ACCESS_POLICY_CACHE_TAG, "max");
}

export const resolveEffectiveAppPermissions = cache(async (userId: string) => {
	const now = new Date();
	const activeMemberships = await db
		.select({
			roleId: appRoleMembers.roleId,
			roleKey: appRoles.key,
		})
		.from(appRoleMembers)
		.innerJoin(appRoles, eq(appRoles.id, appRoleMembers.roleId))
		.where(
			and(
				eq(appRoleMembers.userId, userId),
				eq(appRoleMembers.active, true),
				or(isNull(appRoleMembers.expiresAt), gt(appRoleMembers.expiresAt, now)),
			),
		);

	const permissions = new Set<AppPermission>();
	const roleKeys = activeMemberships.map((membership) => membership.roleKey);
	if (activeMemberships.length) {
		const rows = await db
			.select({ key: appPermissions.key })
			.from(appRolePermissions)
			.innerJoin(
				appPermissions,
				eq(appPermissions.id, appRolePermissions.permissionId),
			)
			.where(
				inArray(
					appRolePermissions.roleId,
					activeMemberships.map((membership) => membership.roleId),
				),
			);
		for (const row of rows) if (isAppPermission(row.key)) permissions.add(row.key);
	}

	const overrides = await db
		.select({
			key: appPermissions.key,
			effect: appUserPermissionOverrides.effect,
		})
		.from(appUserPermissionOverrides)
		.innerJoin(
			appPermissions,
			eq(appPermissions.id, appUserPermissionOverrides.permissionId),
		)
		.where(
			and(
				eq(appUserPermissionOverrides.userId, userId),
				eq(appUserPermissionOverrides.active, true),
				or(
					isNull(appUserPermissionOverrides.expiresAt),
					gt(appUserPermissionOverrides.expiresAt, now),
				),
			),
		);
	for (const override of overrides) {
		if (!isAppPermission(override.key)) continue;
		if (override.effect === "deny") permissions.delete(override.key);
		if (override.effect === "allow") permissions.add(override.key);
	}
	for (const permission of permissionsForProducts(
		await directProductGrantsForUser(userId),
	)) {
		permissions.add(permission);
	}
	for (const permission of permissionsForProducts(
		[...(await directProductRevocationsForUser(userId))],
	)) {
		permissions.delete(permission);
	}
	return { permissions, roleKeys };
});

export const getCurrentAccessContext = cache(
	async (): Promise<AccessContext | null> => {
		if (isUiTestAuthBypassEnabled()) {
			return {
				userId: "capinsta-ui-verification-user",
				email: "ui-test@capinsta.local",
				accountStatus: "active",
				productAccessStatus: "approved",
				productAccessExpired: false,
				productAccessExpiresAt: null,
				emailConfirmedAt: null,
				lastAuthenticatedAt: new Date(),
				authProviderSnapshot: "ui-test",
				permissions: new Set(["app.access", "projects.access", "editor.access", "clipper.access", "exports.access", "render.access"]),
				explicitGrantPermissions: new Set(["app.access", "projects.access", "editor.access", "clipper.access", "exports.access", "render.access"]),
				explicitRevocationPermissions: new Set(),
				roleKeys: ["member"],
				isAdmin: false,
				isSuperAdmin: false,
				sitePolicy: await getSiteAccessPolicy(),
			};
		}
		const supabase = await createClient();
		const {
			data: { user },
		} = await supabase.auth.getUser();
		if (!user) return null;

		const [profile] = await db
			.select()
			.from(profiles)
			.where(eq(profiles.userId, user.id))
			.limit(1);
		if (!profile) return null;

		const [{ permissions, roleKeys }, sitePolicy, adminContext, directGrants, directRevocations] =
			await Promise.all([
				resolveEffectiveAppPermissions(user.id),
				getSiteAccessPolicy(),
				getCurrentAdminContext(),
				directProductGrantsForUser(user.id),
				directProductRevocationsForUser(user.id),
			]);
		const expiresAt = profile.productAccessExpiresAt;
		const productAccessStatus = isProductAccessStatus(
			profile.productAccessStatus,
		)
			? profile.productAccessStatus
			: "pending";
		return {
			userId: user.id,
			email: user.email ?? profile.emailSnapshot,
			accountStatus: profile.accountStatus,
			productAccessStatus,
			productAccessExpired: Boolean(expiresAt && expiresAt <= new Date()),
			productAccessExpiresAt: expiresAt,
			emailConfirmedAt: profile.emailConfirmedAt,
			lastAuthenticatedAt: user.last_sign_in_at
				? new Date(user.last_sign_in_at)
				: profile.lastSignInAt,
			authProviderSnapshot: profile.authProviderSnapshot,
			permissions,
			explicitGrantPermissions: permissionsForProducts(directGrants),
			explicitRevocationPermissions: permissionsForProducts([...directRevocations]),
			roleKeys,
			isAdmin: Boolean(adminContext),
			isSuperAdmin: Boolean(adminContext?.roleKeys.includes("super_admin")),
			sitePolicy,
		};
	},
);

export function canBypassMaintenance(context: AccessContext) {
	return (
		context.isSuperAdmin || context.permissions.has("maintenance.bypass")
	);
}

export function isPendingPrivateBetaUser(context: AccessContext) {
	return (
		context.productAccessStatus === "pending" || context.productAccessExpired
	);
}

export function appPermissionForPath(pathname: string): AppPermission {
	if (pathname.startsWith("/clipper")) return "clipper.access";
	if (pathname.startsWith("/editor")) return "editor.access";
	if (pathname.startsWith("/render")) return "render.access";
	if (pathname.startsWith("/api/capinsta/api/export")) return "exports.access";
	if (pathname.startsWith("/api/capinsta/api/jobs")) return "editor.access";
	if (pathname.startsWith("/api/capinsta/api/captions")) return "editor.access";
	if (pathname.startsWith("/api/capinsta/api/media")) return "editor.access";
	if (pathname.startsWith("/api/capinsta/api/capinsta/media"))
		return "editor.access";
	if (pathname.startsWith("/api/capinsta/api/clipping"))
		return "clipper.access";
	if (pathname.startsWith("/api/capinsta/api/projects")) return "projects.access";
	if (pathname.startsWith("/projects")) return "projects.access";
	return "app.access";
}

export function accessDenial(
	context: AccessContext | null,
	permission: AppPermission,
) {
	return accessDenialForContext(context, permission);
}

export async function requireAuthenticatedUser(pathname: string) {
	const context = await getCurrentAccessContext();
	if (!context) redirect(signInPathFor(pathname));
	return context;
}

export async function requireAppPermission(
	permission: AppPermission,
	pathname: string,
) {
	const context = await requireAuthenticatedUser(pathname);
	const denial = accessDenial(context, permission);
	if (!denial) return context;
	if (["denied_coming_soon", "denied_missing_entitlement"].includes(denial.code)) redirect("/access-pending");
	if (denial.code === "denied_maintenance") redirect("/maintenance");
	if (["denied_restricted", "denied_banned", "denied_security_blocked"].includes(denial.code)) redirect("/access-revoked");
	if (["denied_suspended", "denied_disabled"].includes(denial.code)) redirect("/account-unavailable");
	if (denial.code === "denied_expired_entitlement") redirect("/access-expired");
	notFound();
}

export async function requireAppAccess(pathname: string) {
	return requireAppPermission(appPermissionForPath(pathname), pathname);
}

export async function resolvePostAuthDestination(
	userId: string,
	requestedPath: string,
) {
	const context = await getCurrentAccessContext();
	if (!context || context.userId !== userId) return "/sign-in";
	const destination = requestedPath || "/";
	const denial = accessDenial(context, appPermissionForPath(destination));
	if (!denial) return destination;
	if (["denied_coming_soon", "denied_missing_entitlement"].includes(denial.code)) return "/access-pending";
	if (denial.code === "denied_expired_entitlement") return "/access-expired";
	if (["denied_restricted", "denied_banned", "denied_security_blocked"].includes(denial.code)) return "/access-revoked";
	if (denial.code === "denied_maintenance") return "/maintenance";
	if (["denied_suspended", "denied_disabled"].includes(denial.code)) return "/account-unavailable";
	return "/";
}

export async function requireApiPermission(
	permission: AppPermission,
	_pathname: string,
) {
	const context = await getCurrentAccessContext();
	const denial = accessDenial(context, permission);
	if (!denial) return null;
	return Response.json(
		{ detail: denial.decision.userMessage, code: denial.code, effectiveLaunchMode: denial.decision.effectiveLaunchMode },
		{ status: denial.status },
	);
}
