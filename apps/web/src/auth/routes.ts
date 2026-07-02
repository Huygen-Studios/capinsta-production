/* eslint-disable opencut/prefer-object-params -- Route helpers are intentionally small value utilities. */
export const DEFAULT_AUTHENTICATED_PATH = "/";

export function isUiTestAuthBypassEnabled(
	env: Record<string, string | undefined> = process.env,
) {
	return (
		env.NODE_ENV !== "production" && env.CAPINSTA_UI_TEST_AUTH === "true"
	);
}

const PROTECTED_PREFIXES = [
	"/projects",
	"/editor",
	"/dashboard",
	"/settings",
	"/render",
	"/export",
] as const;

const WAITLIST_PREFIXES = ["/waitlist", "/early-access"] as const;

export function isProtectedPath(pathname: string): boolean {
	return PROTECTED_PREFIXES.some(
		(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
	);
}

export function isWaitlistPath(pathname: string): boolean {
	return WAITLIST_PREFIXES.some(
		(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
	);
}

export function isSafeInternalPath(
	value: string | null | undefined,
	fallback = DEFAULT_AUTHENTICATED_PATH,
): string {
	if (
		!value ||
		!value.startsWith("/") ||
		value.startsWith("//") ||
		value.includes("\\") ||
		value.includes("\0")
	) {
		return fallback;
	}

	try {
		const parsed = new URL(value, "https://capinsta.invalid");
		if (parsed.origin !== "https://capinsta.invalid") return fallback;
		return `${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return fallback;
	}
}

export function signInPathFor(pathname: string, search = ""): string {
	const requestedPath = isSafeInternalPath(
		`${pathname}${search}`,
		DEFAULT_AUTHENTICATED_PATH,
	);
	return `/sign-in?redirect=${encodeURIComponent(requestedPath)}`;
}
