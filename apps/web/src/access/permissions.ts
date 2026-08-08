export const SITE_ACCESS_MODES = [
	"coming_soon",
	"maintenance",
	"public",
] as const;

export type SiteAccessMode = (typeof SITE_ACCESS_MODES)[number];

export const PRODUCT_ACCESS_STATUSES = [
	"pending",
	"approved",
	"revoked",
] as const;

export type ProductAccessStatus = (typeof PRODUCT_ACCESS_STATUSES)[number];

export const APP_PERMISSIONS = [
	"app.access",
	"projects.access",
	"editor.access",
	"clipper.access",
	"exports.access",
	"render.access",
	"internal.diagnostics.access",
	"maintenance.bypass",
] as const;

export type AppPermission = (typeof APP_PERMISSIONS)[number];

export const APP_ROLES = ["member", "developer"] as const;

export type AppRole = (typeof APP_ROLES)[number];

export function isAppPermission(value: string): value is AppPermission {
	return (APP_PERMISSIONS as readonly string[]).includes(value);
}

export function isAppRole(value: string): value is AppRole {
	return (APP_ROLES as readonly string[]).includes(value);
}

export function isSiteAccessMode(value: string): value is SiteAccessMode {
	return (SITE_ACCESS_MODES as readonly string[]).includes(value);
}

export function isProductAccessStatus(
	value: string,
): value is ProductAccessStatus {
	return (PRODUCT_ACCESS_STATUSES as readonly string[]).includes(value);
}
