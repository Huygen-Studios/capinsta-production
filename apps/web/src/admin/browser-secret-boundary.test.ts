import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("admin browser secret boundary", () => {
  test("server secrets are not NEXT_PUBLIC variables", () => {
    const envSource = readFileSync(
      join(import.meta.dir, "../env/web.ts"),
      "utf8",
    );
    for (const secret of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "ADMIN_SECURITY_PEPPER",
      "INTERNAL_ADMIN_API_SECRET",
      "UPSTASH_REDIS_REST_TOKEN",
    ]) {
      expect(envSource).toContain(secret);
      expect(envSource).not.toContain(`NEXT_PUBLIC_${secret}`);
    }
  });

  test("admin client components do not import server authorization", () => {
    for (const file of ["admin-login-form.tsx", "admin-mfa-form.tsx"]) {
      const source = readFileSync(
        join(import.meta.dir, "../components/admin", file),
        "utf8",
      );
      expect(source).not.toContain("@/admin/auth");
      expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    }
  });
});
