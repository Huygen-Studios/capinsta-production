import { describe, expect, test } from "bun:test";
import { assertSafeBenchmarkEnvironment } from "./benchmark-environment";

describe("benchmark environment", () => {
	test("requires benchmark mode and rejects inherited external credentials", () => {
		expect(() => assertSafeBenchmarkEnvironment({})).toThrow("CAPINSTA_ENV=benchmark");
		expect(() => assertSafeBenchmarkEnvironment({ CAPINSTA_ENV: "benchmark", CAPINSTA_BENCHMARK_ROOT: "C:\\tmp\\benchmark", DATABASE_URL: "postgresql://production.example/db" })).toThrow("DATABASE_URL");
		expect(() => assertSafeBenchmarkEnvironment({ CAPINSTA_ENV: "benchmark" })).toThrow("CAPINSTA_BENCHMARK_ROOT");
		expect(() => assertSafeBenchmarkEnvironment({ CAPINSTA_ENV: "benchmark", CAPINSTA_BENCHMARK_ROOT: "C:\\tmp\\benchmark" })).not.toThrow();
	});
});
