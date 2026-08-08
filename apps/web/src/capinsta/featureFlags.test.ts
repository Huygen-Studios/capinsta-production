import { describe, expect, test } from "bun:test";
import {
	getCapinstaApiBaseUrl,
	getCapinstaJobPollIntervalMs,
	getCapinstaJobTimeoutMs,
	getCapinstaMediaUploadBaseUrl,
	isCapinstaProjectHandoffEnabled,
	isCapinstaSampleImportEnabled,
	isServerBackedEditorMediaEnabled,
} from "./featureFlags";

function restoreEnv({
	name,
	value,
}: {
	name:
		| "NEXT_PUBLIC_ENABLE_CAPINSTA_SAMPLE_IMPORT"
		| "NEXT_PUBLIC_CAPINSTA_API_BASE_URL"
		| "NEXT_PUBLIC_CAPINSTA_JOB_TIMEOUT_MS"
		| "NEXT_PUBLIC_CAPINSTA_JOB_POLL_INTERVAL_MS"
		| "NEXT_PUBLIC_ENABLE_CAPINSTA_PROJECT_HANDOFF"
		| "NEXT_PUBLIC_ENABLE_SERVER_BACKED_EDITOR_MEDIA";
	value: string | undefined;
}) {
	if (value === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = value;
}

describe("Capinsta feature flags", () => {
	test("keeps sample import disabled by default", () => {
		const previous = process.env.NEXT_PUBLIC_ENABLE_CAPINSTA_SAMPLE_IMPORT;
		delete process.env.NEXT_PUBLIC_ENABLE_CAPINSTA_SAMPLE_IMPORT;

		expect(isCapinstaSampleImportEnabled()).toBe(false);

		restoreEnv({
			name: "NEXT_PUBLIC_ENABLE_CAPINSTA_SAMPLE_IMPORT",
			value: previous,
		});
	});

	test("enables sample import from the direct Next public flag", () => {
		const previous = process.env.NEXT_PUBLIC_ENABLE_CAPINSTA_SAMPLE_IMPORT;
		process.env.NEXT_PUBLIC_ENABLE_CAPINSTA_SAMPLE_IMPORT = "true";

		expect(isCapinstaSampleImportEnabled()).toBe(true);

		restoreEnv({
			name: "NEXT_PUBLIC_ENABLE_CAPINSTA_SAMPLE_IMPORT",
			value: previous,
		});
	});

	test("uses a configured public Capinsta API URL when provided", () => {
		const previous = process.env.NEXT_PUBLIC_CAPINSTA_API_BASE_URL;
		const previousNodeEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = "development";
		process.env.NEXT_PUBLIC_CAPINSTA_API_BASE_URL = "http://127.0.0.1:8000/";

		expect(getCapinstaApiBaseUrl()).toBe("http://127.0.0.1:8000/");

		restoreEnv({
			name: "NEXT_PUBLIC_CAPINSTA_API_BASE_URL",
			value: previous,
		});
		if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
		else process.env.NODE_ENV = previousNodeEnv;
	});

	test("rejects unsafe absolute API URLs in production browser config", () => {
		const previous = process.env.NEXT_PUBLIC_CAPINSTA_API_BASE_URL;
		const previousNodeEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = "production";
		process.env.NEXT_PUBLIC_CAPINSTA_API_BASE_URL = "http://api:10000";

		expect(getCapinstaApiBaseUrl()).toBe("/api/capinsta");

		restoreEnv({
			name: "NEXT_PUBLIC_CAPINSTA_API_BASE_URL",
			value: previous,
		});
		if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
		else process.env.NODE_ENV = previousNodeEnv;
	});

	test("requires explicit handoff and server-backed media gates", () => {
		const previousHandoff =
			process.env.NEXT_PUBLIC_ENABLE_CAPINSTA_PROJECT_HANDOFF;
		const previousMedia =
			process.env.NEXT_PUBLIC_ENABLE_SERVER_BACKED_EDITOR_MEDIA;
		delete process.env.NEXT_PUBLIC_ENABLE_CAPINSTA_PROJECT_HANDOFF;
		delete process.env.NEXT_PUBLIC_ENABLE_SERVER_BACKED_EDITOR_MEDIA;
		expect(isCapinstaProjectHandoffEnabled()).toBe(false);
		expect(isServerBackedEditorMediaEnabled()).toBe(false);
		process.env.NEXT_PUBLIC_ENABLE_CAPINSTA_PROJECT_HANDOFF = "true";
		process.env.NEXT_PUBLIC_ENABLE_SERVER_BACKED_EDITOR_MEDIA = "true";
		expect(isCapinstaProjectHandoffEnabled()).toBe(true);
		expect(isServerBackedEditorMediaEnabled()).toBe(true);
		restoreEnv({
			name: "NEXT_PUBLIC_ENABLE_CAPINSTA_PROJECT_HANDOFF",
			value: previousHandoff,
		});
		restoreEnv({
			name: "NEXT_PUBLIC_ENABLE_SERVER_BACKED_EDITOR_MEDIA",
			value: previousMedia,
		});
	});

	test("uses the same-origin Capinsta proxy by default", () => {
		const previous = process.env.NEXT_PUBLIC_CAPINSTA_API_BASE_URL;
		delete process.env.NEXT_PUBLIC_CAPINSTA_API_BASE_URL;

		expect(getCapinstaApiBaseUrl()).toBe("/api/capinsta");

		restoreEnv({
			name: "NEXT_PUBLIC_CAPINSTA_API_BASE_URL",
			value: previous,
		});
	});

	test("uses a configurable caption job timeout", () => {
		const previous = process.env.NEXT_PUBLIC_CAPINSTA_JOB_TIMEOUT_MS;
		process.env.NEXT_PUBLIC_CAPINSTA_JOB_TIMEOUT_MS = "1500";

		expect(getCapinstaJobTimeoutMs()).toBe(1500);

		if (previous === undefined) {
			delete process.env.NEXT_PUBLIC_CAPINSTA_JOB_TIMEOUT_MS;
			return;
		}
		process.env.NEXT_PUBLIC_CAPINSTA_JOB_TIMEOUT_MS = previous;
	});

	test("defaults caption job timeout to backend-aligned ten minutes", () => {
		const previous = process.env.NEXT_PUBLIC_CAPINSTA_JOB_TIMEOUT_MS;
		delete process.env.NEXT_PUBLIC_CAPINSTA_JOB_TIMEOUT_MS;

		expect(getCapinstaJobTimeoutMs()).toBe(600000);

		restoreEnv({
			name: "NEXT_PUBLIC_CAPINSTA_JOB_TIMEOUT_MS",
			value: previous,
		});
	});

	test("uses a configurable caption job poll interval", () => {
		const previous = process.env.NEXT_PUBLIC_CAPINSTA_JOB_POLL_INTERVAL_MS;
		process.env.NEXT_PUBLIC_CAPINSTA_JOB_POLL_INTERVAL_MS = "750";

		expect(getCapinstaJobPollIntervalMs()).toBe(750);

		restoreEnv({
			name: "NEXT_PUBLIC_CAPINSTA_JOB_POLL_INTERVAL_MS",
			value: previous,
		});
	});

	test("uses configured media upload origin when provided", () => {
		const previous = process.env.NEXT_PUBLIC_CAPINSTA_MEDIA_UPLOAD_ORIGIN;
		process.env.NEXT_PUBLIC_CAPINSTA_MEDIA_UPLOAD_ORIGIN =
			"https://api.capinsta.huygenstudios.com";

		expect(getCapinstaMediaUploadBaseUrl()).toBe(
			"https://api.capinsta.huygenstudios.com",
		);

		if (previous === undefined) {
			delete process.env.NEXT_PUBLIC_CAPINSTA_MEDIA_UPLOAD_ORIGIN;
		} else {
			process.env.NEXT_PUBLIC_CAPINSTA_MEDIA_UPLOAD_ORIGIN = previous;
		}
	});
});
