import { z } from "zod";

const webEnvSchema = z.object({
	// Node
	NODE_ENV: z.enum(["development", "production", "test"]),
	ANALYZE: z.string().optional(),
	NEXT_RUNTIME: z.enum(["nodejs", "edge"]).optional(),

	// Public
	NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
	NEXT_PUBLIC_SUPABASE_URL: z.url(),
	NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
	NEXT_PUBLIC_MARBLE_API_URL: z.url(),
	NEXT_PUBLIC_GA_MEASUREMENT_ID: z.string().optional(),
	NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: z.string().optional(),
	NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
	NEXT_PUBLIC_POSTHOG_HOST: z.url().optional(),
	NEXT_PUBLIC_SENTRY_DSN: z.url().optional(),
	NEXT_PUBLIC_ENABLE_GOOGLE_OAUTH: z.enum(["true", "false"]).default("true"),

	// Server
	DATABASE_URL: z
		.string()
		.refine(
			(url) => url.startsWith("postgres://") || url.startsWith("postgresql://"),
			"DATABASE_URL must be a postgres:// or postgresql:// URL",
		),

	UPSTASH_REDIS_REST_URL: z.url(),
	UPSTASH_REDIS_REST_TOKEN: z.string(),
	MARBLE_WORKSPACE_KEY: z.string(),
	SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
	ADMIN_SECURITY_PEPPER: z.string().min(32),
	BACKEND_INTERNAL_URL: z.url().default("http://127.0.0.1:8000"),
	INTERNAL_ADMIN_API_SECRET: z.string().min(32),
	ADMIN_ASSERTION_ISSUER: z.string().min(3).default("capinsta-web"),
	INTERNAL_MAINTENANCE_SECRET: z.string().min(32),
	TRUSTED_PROXY_MODE: z.enum(["none", "cloudflare", "coolify"]).default("none"),
	ENABLE_WHOP_ACCESS: z.enum(["true", "false"]).default("false"),
	ENABLE_ACCOUNT_DELETION: z.enum(["true", "false"]).default("false"),
	ACCOUNT_DELETION_RECENT_AUTH_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
	PRIVATE_BETA_MAX_USERS: z.coerce.number().int().min(0).max(100_000).default(0),
	PRIVATE_BETA_ALLOWLIST: z.string().optional(),
	WHOP_APP_ID: z.string().min(6).optional(),
	WHOP_API_KEY: z.string().min(20).optional(),
	WHOP_PRODUCT_ID: z.string().min(6).optional(),
	CAPINSTA_ADMIN_BOOTSTRAP_USER_ID: z.uuid().optional(),
	RAZORPAY_KEY_ID: z.string().min(1).optional(),
	RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
	RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),
	RAZORPAY_WEBHOOK_PREVIOUS_SECRET: z.string().min(1).optional(),
	PAYMENT_ENVIRONMENT: z.enum(["test", "live"]).default("test"),
	PAYMENTS_ENABLED: z.enum(["true", "false"]).default("false"),
	APP_URL: z.url().optional(),
	PAYMENT_SUPPORT_EMAIL: z.email().optional(),
	DONATION_RECEIPTS_ENABLED: z.enum(["true", "false"]).default("true"),
	DEDICATED_WORKER_PROVISIONING_ADAPTER: z
		.enum(["manual", "external"])
		.default("manual"),
	DEDICATED_WORKER_PROVISIONING_ENDPOINT: z.url().optional(),
	DEDICATED_WORKER_PROVISIONING_TOKEN: z.string().min(1).optional(),
	SENTRY_DSN: z.url().optional(),
	POSTHOG_PROJECT_ID: z.string().optional(),
	POSTHOG_PERSONAL_API_KEY: z.string().optional(),
	POSTHOG_API_HOST: z.url().default("https://us.posthog.com"),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export const webEnv = webEnvSchema.parse(process.env);
