import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const migration = readFileSync(
	join(import.meta.dir, "../../migrations/0006_product_access_entitlements.sql"),
	"utf8",
);
const productAccessSource = readFileSync(
	join(import.meta.dir, "product-access.ts"),
	"utf8",
);

describe("product access entitlement schema", () => {
	test("prevents duplicate per-user product entitlements", () => {
		expect(migration).toContain(
			'CONSTRAINT "app_product_entitlements_pk" PRIMARY KEY ("user_id","product_id")',
		);
	});

	test("creates durable idempotent bulk operations", () => {
		expect(migration).toContain('"app_product_access_bulk_operations"');
		expect(migration).toContain('"idempotency_key" text NOT NULL UNIQUE');
		expect(migration).toContain('"outcome" jsonb NOT NULL');
	});

	test("uses explicit Supabase grants and RLS for new public tables", () => {
		expect(migration).toContain(
			'GRANT SELECT ON "app_product_entitlements" TO authenticated',
		);
		expect(migration).toContain(
			'ALTER TABLE "app_product_entitlements" ENABLE ROW LEVEL SECURITY',
		);
		expect(migration).toContain(
			'ALTER TABLE "app_product_access_bulk_operations" ENABLE ROW LEVEL SECURITY',
		);
	});

	test("login read path tolerates missing entitlement table during deployment rollout", () => {
		expect(productAccessSource).toContain(
			"isMissingProductEntitlementsTableError",
		);
		expect(productAccessSource).toContain('record.code === "42P01"');
		expect(productAccessSource).toContain(
			'code: "app_product_entitlements_missing"',
		);
	});

	test("super admins can grant product access to themselves", () => {
		expect(productAccessSource).toContain("action !== \"grant\"");
		expect(productAccessSource).toContain(
			"!context.roleKeys.includes(\"super_admin\")",
		);
	});
});
