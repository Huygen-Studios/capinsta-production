import { describe, expect, test } from "bun:test";
import type { CapInstaRemotionPropsV1 } from "./contracts";
import { frameFromMilliseconds, metadataForProps, qualityCrf, sequencesForProps, validateRemotionProps } from "./contracts";

const base: CapInstaRemotionPropsV1 = {
	version: 1,
	export: { width: 1080, height: 1920, fps: 30, quality: "high", backgroundColor: "#000000" },
	media: { sources: [{ id: "source", url: "https://example.com/source.mp4", hasAudio: true, accessMode: "remote" }] },
	timeline: { edl: { schemaVersion: 1, clipProjectId: "p", projectRevision: 1, sourceMediaId: "source", sourceDurationMs: 1000, outputDurationMs: 1000, entries: [{ id: "e", rangeId: "r", order: 0, sourceMediaId: "source", sourceStartMs: 0, sourceEndMs: 1000, sourceDurationMs: 1000, outputStartMs: 0, outputEndMs: 1000, outputDurationMs: 1000, playbackRate: 1, transitionIn: null, transitionOut: null, metadata: {} }], warnings: [], metadata: {} } },
};

describe("CapInsta Remotion contract", () => {
	test("uses Rust MediaTime half-up frame rounding without cumulative drift", () => {
		expect(frameFromMilliseconds(16.6666667, 30)).toBe(1);
		expect(frameFromMilliseconds(49.9999999, 30)).toBe(1);
		expect(metadataForProps({ ...base, timeline: { edl: { ...base.timeline.edl, outputDurationMs: 1050, entries: [{ ...base.timeline.edl.entries[0]!, outputEndMs: 1050, outputDurationMs: 1050 }] } } }).durationInFrames).toBe(32);
	});

	test("maps EDL boundaries once and retains playback rate", () => {
		const sequences = sequencesForProps(base);
		expect(sequences[0]).toMatchObject({ from: 0, durationInFrames: 30, trimBefore: 0, trimAfter: 30, entry: { playbackRate: 1 } });
	});

	test("retains supported slow, normal, and fast playback rates", () => {
		for (const playbackRate of [0.5, 1, 2]) {
			const outputDurationMs = 1000 / playbackRate;
			const value = { ...base, timeline: { edl: { ...base.timeline.edl, outputDurationMs, entries: [{ ...base.timeline.edl.entries[0]!, outputEndMs: outputDurationMs, outputDurationMs, playbackRate }] } } };
			expect(sequencesForProps(validateRemotionProps(value))[0]?.entry.playbackRate).toBe(playbackRate);
		}
	});

	test("validates source references and exact quality mapping", () => {
		expect(validateRemotionProps(base).version).toBe(1);
		expect(qualityCrf).toEqual({ fast: 28, draft: 28, standard: 23, balanced: 23, high: 18, best: 16 });
		expect(() => validateRemotionProps({ ...base, media: { sources: [] } })).toThrow();
	});

	test("allows only loopback HTTP for localized benchmark media", () => {
		const loopback = structuredClone(base);
		loopback.media.sources[0].accessMode = "localized";
		loopback.media.sources[0].url = "http://127.0.0.1:8899/source.mp4";
		expect(validateRemotionProps(loopback).media.sources[0].url).toBe(loopback.media.sources[0].url);
		loopback.media.sources[0].url = "http://example.com/source.mp4";
		expect(() => validateRemotionProps(loopback)).toThrow();
	});
});
