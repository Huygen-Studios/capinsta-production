import { describe, expect, test } from "bun:test";
import { accessDenialForContext, requiresApprovedProductAccess } from "./decision";
import type { AppPermission } from "./permissions";

function context({
	productAccessStatus = "approved",
	permissions = ["app.access", "projects.access", "editor.access", "exports.access", "render.access"],
	mode = "public",
	isSuperAdmin = false,
}: {
	productAccessStatus?: "pending" | "approved" | "revoked";
	permissions?: AppPermission[];
	mode?: "public" | "coming_soon" | "maintenance";
	isSuperAdmin?: boolean;
} = {}) {
	return {
		accountStatus: "active",
		productAccessStatus,
		productAccessExpired: false,
		permissions: new Set(permissions),
		isSuperAdmin,
		sitePolicy: { mode },
	};
}

describe("product access decisions", () => {
	test("editor upload/export capabilities require approved product access even in public mode", () => {
		expect(requiresApprovedProductAccess("editor.access")).toBe(true);
		expect(
			accessDenialForContext(
				context({
					productAccessStatus: "pending",
					permissions: ["app.access", "editor.access"],
				}),
				"editor.access",
			),
		).toEqual({ status: 403, code: "product_access_pending" });
	});

	test("approved member still needs the exact requested app permission", () => {
		expect(
			accessDenialForContext(
				context({ permissions: ["app.access", "editor.access"] }),
				"exports.access",
			),
		).toEqual({ status: 403, code: "insufficient_product_permission" });
	});

	test("approved member with matching permission can use product APIs", () => {
		expect(accessDenialForContext(context(), "exports.access")).toBeNull();
	});

	test("normal app access can remain public without granting product capabilities", () => {
		expect(
			accessDenialForContext(
				context({ productAccessStatus: "pending", permissions: ["app.access"] }),
				"app.access",
			),
		).toBeNull();
	});
});
