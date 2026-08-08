import { describe, expect, test } from "bun:test";
import {
  ADMIN_PERMISSIONS,
  isAdminPermission,
  ROLE_PERMISSIONS,
} from "./permissions";

describe("admin RBAC", () => {
  test("super admin receives every defined permission", () => {
    expect(ROLE_PERMISSIONS.super_admin).toEqual(ADMIN_PERMISSIONS);
  });

  test("support cannot manage system flags", () => {
    expect(ROLE_PERMISSIONS.support).not.toContain("feature_flags.manage");
    expect(ROLE_PERMISSIONS.support).not.toContain("system.manage_limits");
  });

  test("analyst has no mutation permissions", () => {
    expect(
      ROLE_PERMISSIONS.analyst.every(
        (permission) =>
          permission.endsWith(".read") || permission === "audit.read",
      ),
    ).toBe(true);
  });

  test("operations cannot manage admin roles", () => {
    expect(ROLE_PERMISSIONS.operations).not.toContain("users.manage_roles");
  });

  test("unknown permissions are denied by the type guard", () => {
    expect(isAdminPermission("users.read")).toBe(true);
    expect(isAdminPermission("users.make_self_super_admin")).toBe(false);
  });
});
