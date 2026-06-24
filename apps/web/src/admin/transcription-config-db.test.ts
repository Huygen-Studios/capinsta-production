import { describe, expect, test } from "bun:test";
import {
	getAdminTranscriptionConfiguration,
	listAdminTranscriptionConfigurations,
	transcriptionPipelineOptionsColumnExists,
} from "./transcription-config-db";
import { DEFAULT_PIPELINE_OPTIONS, TRANSCRIPTION_PROVIDER_CATALOG, mergePipelineOptions } from "@/transcription/provider-catalog";

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

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

	test("deep merges partial pipeline option edits", () => {
		const merged = mergePipelineOptions(
			DEFAULT_PIPELINE_OPTIONS,
			{
				timingSourcePolicy: "native_required",
				captionChunking: { maxWords: 3 },
				autoSync: { enabled: true, maxShiftSeconds: 0.5 },
				__proto__: { polluted: true },
			},
		);

		expect(merged.timingSourcePolicy).toBe("native_required");
		const captionChunking = merged.captionChunking;
		const autoSync = merged.autoSync;
		expect(isRecord(captionChunking) ? captionChunking.maxWords : undefined).toBe(3);
		expect(isRecord(captionChunking) ? captionChunking.maxCharacters : undefined).toBe(36);
		expect(isRecord(autoSync) ? autoSync.enabled : undefined).toBe(true);
		expect(isRecord(autoSync) ? autoSync.minScore : undefined).toBe(0.58);
		expect(Object.prototype).not.toHaveProperty("polluted");
	});

	test("Gemini catalog entries require real local alignment", () => {
		const geminiEntries = TRANSCRIPTION_PROVIDER_CATALOG.filter(
			(entry) => entry.provider === "gemini",
		);

		expect(geminiEntries.length).toBeGreaterThan(0);
		for (const entry of geminiEntries) {
			expect(entry.timestampStrategy).toBe("local_forced_alignment");
			expect(entry.localAlignmentRequired).toBe(true);
		}
	});
});
