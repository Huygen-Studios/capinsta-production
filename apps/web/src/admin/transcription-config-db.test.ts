import { describe, expect, test } from "bun:test";
import {
	getAdminTranscriptionConfiguration,
	listAdminTranscriptionConfigurations,
	transcriptionPipelineOptionsColumnExists,
} from "./transcription-config-db";

function legacyConfigRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "11111111-1111-1111-1111-111111111111",
		provider: "sarvam",
		model: "saaras:v3",
		providerOptions: { mode: "transcribe" },
		timestampStrategy: "native_word_timestamps",
		strictProvider: true,
		status: "active",
		version: 7,
		testStatus: "passed",
		testedAt: new Date("2026-06-24T00:00:00.000Z"),
		testedBy: null,
		testErrorCode: null,
		testLatencyMs: 120,
		activatedAt: new Date("2026-06-24T00:01:00.000Z"),
		activatedBy: null,
		activationReason: "production verification",
		createdAt: new Date("2026-06-24T00:00:00.000Z"),
		updatedAt: new Date("2026-06-24T00:02:00.000Z"),
		...overrides,
	};
}

describe("admin transcription configuration db compatibility", () => {
	test("detects when pipeline_options is missing", async () => {
		const executor = {
			async execute() {
				return [{ exists: false }];
			},
		};

		await expect(transcriptionPipelineOptionsColumnExists(executor)).resolves.toBe(
			false,
		);
	});

	test("lists legacy configurations with default pipeline options", async () => {
		let calls = 0;
		const executor = {
			async execute() {
				calls += 1;
				if (calls === 1) return [{ exists: false }];
				return [legacyConfigRow({ pipelineOptions: null })];
			},
		};

		const [config] = await listAdminTranscriptionConfigurations(executor);

		expect(config.provider).toBe("sarvam");
		expect(config.pipelineOptions.timingSourcePolicy).toBe("native_then_forced");
	});

	test("loads malformed legacy pipeline options without crashing", async () => {
		let calls = 0;
		const executor = {
			async execute() {
				calls += 1;
				if (calls === 1) return [{ exists: true }];
				return [legacyConfigRow({ pipelineOptions: "not-json-object" })];
			},
		};

		const config = await getAdminTranscriptionConfiguration(
			executor,
			"11111111-1111-1111-1111-111111111111",
		);

		expect(config?.pipelineOptions.timingSourcePolicy).toBe(
			"native_then_forced",
		);
	});
});
