import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("PostHog admin metrics configuration", () => {
	test("keeps visitor query credentials server-only", () => {
		const envSource = readFileSync(join(import.meta.dir, "../env/web.ts"), "utf8");
		expect(envSource).toContain("NEXT_PUBLIC_POSTHOG_KEY");
		expect(envSource).toContain("NEXT_PUBLIC_POSTHOG_HOST");
		expect(envSource).toContain("POSTHOG_PROJECT_ID");
		expect(envSource).toContain("POSTHOG_PERSONAL_API_KEY");
		expect(envSource).not.toContain("NEXT_PUBLIC_POSTHOG_PERSONAL_API_KEY");
	});

	test("queries PostHog from the server with no-store fetch", () => {
		const source = readFileSync(join(import.meta.dir, "posthog.ts"), "utf8");
		expect(source).toContain("server-only");
		expect(source).toContain("POSTHOG_PERSONAL_API_KEY");
		expect(source).toContain("POSTHOG_PROJECT_ID");
		expect(source).toContain("cache: \"no-store\"");
		expect(source).toContain("count(distinct person_id)");
	});

	test("browser SDK uses the configured reverse proxy host", () => {
		const source = readFileSync(
			join(import.meta.dir, "../components/analytics/posthog-provider.tsx"),
			"utf8",
		);
		expect(source).toContain("api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST");
		expect(source).toContain("ui_host: \"https://us.posthog.com\"");
		expect(source).toContain("process.env.NODE_ENV !== \"test\"");
	});
});
