import { describe, expect, test } from "bun:test";
import { adminRoutes, isUuid } from "./routes";
describe("admin route builder", () => {
	test("builds the canonical managed-user security route", () => {
		const id = "31235253-15f6-41c9-b7cc-3c8a65014340";
		expect(isUuid(id)).toBe(true);
		expect(adminRoutes.userSecurity({ userId: id })).toBe(`/admincapinsta11/security/users/${id}`);
	});
	test("rejects malformed UUID route parameters", () => expect(isUuid("../../users")).toBe(false));
});
