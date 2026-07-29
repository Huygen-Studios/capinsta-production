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
	const configured = process.env.NEXT_PUBLIC_CAPINSTA_API_BASE_URL?.trim();
	if (!configured) return "/api/capinsta";
	if (process.env.NODE_ENV === "production") {
		try {
			const url = new URL(configured);
			if (
				["api", "localhost", "127.0.0.1", "0.0.0.0"].includes(
					url.hostname.toLowerCase(),
				)
			) {
				return "/api/capinsta";
			}
		} catch {
			// Relative same-origin overrides are safe.
		}
	}
	return configured;
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

export function isCapinstaProjectHandoffEnabled(): boolean {
	const value = process.env.NEXT_PUBLIC_ENABLE_CAPINSTA_PROJECT_HANDOFF || "";
	return truthyValues.has(value.toLowerCase());
}

export function isServerBackedEditorMediaEnabled(): boolean {
	const value =
		process.env.NEXT_PUBLIC_ENABLE_SERVER_BACKED_EDITOR_MEDIA || "";
	return truthyValues.has(value.toLowerCase());
}

export const CAPINSTA_TRANSCRIPT_CONTRACT_VERSION = "capinsta.transcript.v1";
