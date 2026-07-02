import { defineConfig } from "@playwright/test";

const e2eBaseURL =
  process.env.CAPINSTA_QA_URL ??
  process.env.ADMIN_E2E_BASE_URL ??
  "http://127.0.0.1:3000";

process.env.CAPINSTA_QA_URL = e2eBaseURL;
process.env.ADMIN_E2E_BASE_URL = process.env.ADMIN_E2E_BASE_URL ?? e2eBaseURL;
process.env.CAPINSTA_UI_TEST_AUTH =
  process.env.CAPINSTA_UI_TEST_AUTH ?? "true";
process.env.UI_VERIFICATION = process.env.UI_VERIFICATION ?? "true";

const localEnv = {
  ...process.env,
  NODE_ENV: "development",
  NEXT_PUBLIC_SITE_URL: e2eBaseURL,
  NEXT_PUBLIC_SUPABASE_URL:
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "local-e2e-anon-key",
  NEXT_PUBLIC_MARBLE_API_URL:
    process.env.NEXT_PUBLIC_MARBLE_API_URL ?? "http://127.0.0.1:3001",
  NEXT_PUBLIC_ENABLE_GOOGLE_OAUTH:
    process.env.NEXT_PUBLIC_ENABLE_GOOGLE_OAUTH ?? "false",
  DATABASE_URL:
    process.env.DATABASE_URL ?? "postgresql://capinsta:capinsta@127.0.0.1:54322/capinsta",
  UPSTASH_REDIS_REST_URL:
    process.env.UPSTASH_REDIS_REST_URL ?? "https://example-upstash.invalid",
  UPSTASH_REDIS_REST_TOKEN:
    process.env.UPSTASH_REDIS_REST_TOKEN ?? "local-e2e-upstash-token",
  MARBLE_WORKSPACE_KEY:
    process.env.MARBLE_WORKSPACE_KEY ?? "local-e2e-marble-workspace",
  SUPABASE_SERVICE_ROLE_KEY:
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "local-e2e-placeholder-service-role-key",
  ADMIN_SECURITY_PEPPER:
    process.env.ADMIN_SECURITY_PEPPER ??
    "local-e2e-admin-security-pepper-32bytes",
  INTERNAL_ADMIN_API_SECRET:
    process.env.INTERNAL_ADMIN_API_SECRET ??
    "local-e2e-internal-admin-secret-32",
  INTERNAL_MAINTENANCE_SECRET:
    process.env.INTERNAL_MAINTENANCE_SECRET ??
    "local-e2e-maintenance-secret-32bytes",
  BACKEND_INTERNAL_URL: process.env.BACKEND_INTERNAL_URL ?? "http://127.0.0.1:8000",
  TRUSTED_PROXY_MODE: process.env.TRUSTED_PROXY_MODE ?? "none",
  CAPINSTA_UI_TEST_AUTH: process.env.CAPINSTA_UI_TEST_AUTH,
  UI_VERIFICATION: process.env.UI_VERIFICATION,
  NEXT_PUBLIC_CAPINSTA_DEBUG: process.env.NEXT_PUBLIC_CAPINSTA_DEBUG ?? "false",
};

export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  webServer:
    process.env.CAPINSTA_E2E_SKIP_WEBSERVER === "true"
      ? undefined
      : {
          command: "bun run dev -- --webpack --hostname 127.0.0.1 --port 3000",
          url: `${e2eBaseURL}/api/health`,
          timeout: 120_000,
          reuseExistingServer: true,
          env: localEnv,
        },
  use: {
    baseURL: e2eBaseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
