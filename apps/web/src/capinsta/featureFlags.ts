const truthyValues = new Set(["1", "true", "yes", "on", "enabled"]);

export function isAiCaptionsEnabled(): boolean {
	const value =
		process.env.NEXT_PUBLIC_ENABLE_AI_CAPTIONS ||
		process.env.VITE_ENABLE_AI_CAPTIONS ||
		"";
	return truthyValues.has(value.toLowerCase());
}

export function isCapinstaSampleImportEnabled(): boolean {
	const value =
		process.env.NEXT_PUBLIC_ENABLE_CAPINSTA_SAMPLE_IMPORT ||
		process.env.NEXT_PUBLIC_ENABLE_AI_CAPTIONS ||
		process.env.VITE_ENABLE_AI_CAPTIONS ||
		"";
	return truthyValues.has(value.toLowerCase());
}

export function getCapinstaApiBaseUrl(): string {
	return "/api/capinsta";
}

export function getCapinstaJobTimeoutMs(): number {
	const raw = process.env.NEXT_PUBLIC_CAPINSTA_JOB_TIMEOUT_MS || "";
	const parsed = Number(raw);
	if (Number.isFinite(parsed) && parsed > 0) return parsed;
	return 10 * 60 * 1000;
}

export function getCapinstaJobPollIntervalMs(): number {
	const raw = process.env.NEXT_PUBLIC_CAPINSTA_JOB_POLL_INTERVAL_MS || "";
	const parsed = Number(raw);
	if (Number.isFinite(parsed) && parsed > 0) return parsed;
	return 2000;
}

export function isCapinstaDebugEnabled(): boolean {
	const value = process.env.NEXT_PUBLIC_CAPINSTA_DEBUG || "";
	return truthyValues.has(value.toLowerCase());
}

export const CAPINSTA_TRANSCRIPT_CONTRACT_VERSION = "capinsta.transcript.v1";
