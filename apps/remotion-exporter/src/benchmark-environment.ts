const EXTERNAL_ENV_KEYS = [
	"ADMIN_DATABASE_URL", "DATABASE_URL", "SUPABASE_URL", "SUPABASE_JWT_SECRET",
	"SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY", "R2_ACCOUNT_ID", "R2_ENDPOINT",
	"R2_ENDPOINT_URL", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "AWS_ACCESS_KEY_ID",
	"AWS_SECRET_ACCESS_KEY", "S3_ENDPOINT",
] as const;

export function assertSafeBenchmarkEnvironment(environment: NodeJS.ProcessEnv = process.env) {
	if (environment.CAPINSTA_ENV?.trim().toLowerCase() !== "benchmark") throw new Error("BENCHMARK_ENV_UNSAFE: CAPINSTA_ENV=benchmark is required");
	if (!environment.CAPINSTA_BENCHMARK_ROOT?.trim()) throw new Error("BENCHMARK_ENV_UNSAFE: CAPINSTA_BENCHMARK_ROOT is required");
	const configured = EXTERNAL_ENV_KEYS.filter((key) => environment[key]?.trim());
	if (configured.length && environment.CAPINSTA_BENCHMARK_ALLOW_EXTERNAL_MUTATION !== "I_UNDERSTAND_THIS_CAN_MUTATE_EXTERNAL_SYSTEMS") {
		throw new Error(`BENCHMARK_ENV_UNSAFE: external configuration is set: ${configured.join(", ")}`);
	}
}
