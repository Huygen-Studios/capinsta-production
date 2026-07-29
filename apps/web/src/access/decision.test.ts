import { describe, expect, test } from "bun:test";
import { evaluateProductAccess, PRODUCT_CAPABILITIES, type ProductAccessEvaluation } from "./decision";

function input(overrides: Partial<ProductAccessEvaluation> & {
	user?: Partial<NonNullable<ProductAccessEvaluation["user"]>> | null;
	entitlement?: Partial<ProductAccessEvaluation["entitlement"]>;
} = {}): ProductAccessEvaluation {
	return {
		launchMode: overrides.launchMode ?? "public",
		user: overrides.user === null ? null : {
			accountStatus: overrides.user?.accountStatus ?? "active",
			isAdmin: overrides.user?.isAdmin ?? false,
			isSuperAdmin: overrides.user?.isSuperAdmin ?? false,
			hasMaintenanceBypass: overrides.user?.hasMaintenanceBypass ?? false,
		},
		entitlement: {
			status: overrides.entitlement?.status ?? "missing",
			expired: overrides.entitlement?.expired ?? false,
			hasCapabilityGrant: overrides.entitlement?.hasCapabilityGrant ?? false,
			hasCapabilityRevocation: overrides.entitlement?.hasCapabilityRevocation ?? false,
		},
		restriction: overrides.restriction ?? null,
		requestedCapability: overrides.requestedCapability ?? "open_editor",
	};
}

describe("canonical product access policy", () => {
	for (const [name, entitlement] of [
		["no entitlement", { status: "missing" as const }],
		["pending profile", { status: "pending" as const }],
		["granted profile", { status: "approved" as const }],
	]) {
		test(`public allows an authenticated ${name}`, () => {
			expect(evaluateProductAccess(input({ entitlement })).reasonCode).toBe("allowed_public");
		});
	}

	for (const [restriction, reasonCode] of [
		["banned", "denied_banned"],
		["suspended", "denied_suspended"],
		["disabled", "denied_disabled"],
		["security_blocked", "denied_security_blocked"],
	] as const) {
		test(`public denies ${restriction}`, () => {
			const result = evaluateProductAccess(input({ user: { accountStatus: restriction } }));
			expect(result.allowed).toBe(false);
			expect(result.reasonCode).toBe(reasonCode);
		});
	}

	test("public explicit product revocation overrides an old grant", () => {
		const result = evaluateProductAccess(input({ entitlement: {
			status: "approved", hasCapabilityGrant: true, hasCapabilityRevocation: true,
		} }));
		expect(result.reasonCode).toBe("denied_restricted");
	});

	test("coming soon denies missing and pending access", () => {
		for (const status of ["missing", "pending"] as const)
			expect(evaluateProductAccess(input({ launchMode: "coming_soon", entitlement: { status } })).allowed).toBe(false);
	});

	test("coming soon allows an active explicit grant and legacy approval", () => {
		expect(evaluateProductAccess(input({ launchMode: "coming_soon", entitlement: { hasCapabilityGrant: true } })).reasonCode).toBe("allowed_entitlement");
		expect(evaluateProductAccess(input({ launchMode: "coming_soon", entitlement: { status: "approved" } })).reasonCode).toBe("allowed_entitlement");
	});

	test("coming soon denies expired grants, allows admins, and keeps bans effective", () => {
		expect(evaluateProductAccess(input({ launchMode: "coming_soon", entitlement: { status: "approved", expired: true } })).reasonCode).toBe("denied_expired_entitlement");
		expect(evaluateProductAccess(input({ launchMode: "coming_soon", user: { isAdmin: true } })).reasonCode).toBe("allowed_admin");
		expect(evaluateProductAccess(input({ launchMode: "coming_soon", user: { accountStatus: "banned" } })).reasonCode).toBe("denied_banned");
	});

	test("maintenance denies normal users regardless of grants", () => {
		for (const hasCapabilityGrant of [false, true])
			expect(evaluateProductAccess(input({ launchMode: "maintenance", entitlement: { hasCapabilityGrant } })).reasonCode).toBe("denied_maintenance");
	});

	test("maintenance allows administrators, super administrators, and typed bypass", () => {
		expect(evaluateProductAccess(input({ launchMode: "maintenance", user: { isAdmin: true } })).reasonCode).toBe("allowed_admin");
		expect(evaluateProductAccess(input({ launchMode: "maintenance", user: { isSuperAdmin: true } })).reasonCode).toBe("allowed_admin");
		expect(evaluateProductAccess(input({ launchMode: "maintenance", user: { hasMaintenanceBypass: true } })).reasonCode).toBe("allowed_maintenance_bypass");
	});

	test("missing session is always denied", () => {
		expect(evaluateProductAccess(input({ user: null })).reasonCode).toBe("denied_missing_session");
	});

	test("page and direct API capabilities share the public/restriction/mode policy", () => {
		for (const requestedCapability of PRODUCT_CAPABILITIES) {
			expect(evaluateProductAccess(input({ requestedCapability })).allowed).toBe(
				true,
			);
			expect(evaluateProductAccess(input({ requestedCapability, user: { accountStatus: "banned" } })).allowed).toBe(false);
			expect(evaluateProductAccess(input({ requestedCapability, launchMode: "coming_soon" })).allowed).toBe(false);
			expect(evaluateProductAccess(input({ requestedCapability, launchMode: "maintenance", entitlement: { status: "approved", hasCapabilityGrant: true } })).allowed).toBe(false);
		}
	});

	test("public mode allows clipper for active signed-in users", () => {
		expect(evaluateProductAccess(input({
			requestedCapability: "use_clipper",
			entitlement: { status: "pending" },
		})).reasonCode).toBe("allowed_public");
	});
});
