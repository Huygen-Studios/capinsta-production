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
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export const webEnv = webEnvSchema.parse(process.env);
