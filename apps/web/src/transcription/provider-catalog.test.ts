import { describe, expect, test } from "bun:test";
import {
	canonicalizeTranscriptionSelection,
	getTranscriptionCatalogEntry,
	TRANSCRIPTION_PROVIDER_CATALOG,
} from "./provider-catalog";

describe("transcription provider catalog", () => {
	test("does not treat display labels as stored provider keys", () => {
		for (const entry of TRANSCRIPTION_PROVIDER_CATALOG) {
			expect(
				getTranscriptionCatalogEntry({
					provider: entry.displayName,
					model: entry.model,
				}),
			).toBeUndefined();
		}
	});

	test("resolves legacy display labels through explicit aliases", () => {
		const resolved = canonicalizeTranscriptionSelection({
			provider: "Sarvam Saaras v3",
			model: "Sarvam Saaras v3",
		});

		expect(resolved?.provider).toBe("sarvam");
		expect(resolved?.model).toBe("saaras:v3");
		expect(resolved?.aliases).toContain("provider_display_label");
		expect(resolved?.aliases).toContain("model_display_label");
	});
});
