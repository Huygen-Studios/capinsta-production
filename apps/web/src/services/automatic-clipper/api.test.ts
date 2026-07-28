import { describe, expect, test } from "bun:test";
import { parseCandidates, viralCandidateSchema } from "./api";

const candidate = {
	candidateId: "candidate_001",
	sourceStartMs: 20_000,
	sourceEndMs: 50_000,
	durationMs: 30_000,
	title: "A specific payoff",
	hookText: "Watch what changes",
	supportingEmojis: ["👨🏽‍💻", "✨"],
	viralScore: 82,
	scoreBreakdown: {
		hookStrength: 18,
		clarity: 17,
		payoff: 17,
		emotion: 14,
		novelty: 16,
	},
	reason: "A concise setup with a clear result.",
	transcriptEvidence: {
		wordIds: ["word_001"],
		segmentIds: ["seg_001"],
		excerpt: "Synthetic transcript excerpt.",
	},
	recommendedFramingStrategy: "single_subject_crop",
	recommendedCaptionPreset: "word_highlight_box",
	warnings: [],
	status: "proposed",
	projectRevision: 1,
	selectedProjectRevision: null,
} as const;

describe("automatic clipper API contracts", () => {
	test("accepts bounded candidates and preserves multi-codepoint emoji", () => {
		const parsed = parseCandidates([candidate]);
		expect(parsed[0]?.supportingEmojis).toEqual(["👨🏽‍💻", "✨"]);
		expect(parsed[0]?.durationMs).toBe(30_000);
	});

	test("rejects inconsistent timing, scores, and emoji spam at runtime", () => {
		expect(() =>
			viralCandidateSchema.parse({
				...candidate,
				durationMs: 29_000,
				viralScore: 101,
				supportingEmojis: ["1", "2", "3"],
			}),
		).toThrow();
	});

	test("rejects untrusted response fields and invalid layout values", () => {
		expect(() =>
			viralCandidateSchema.parse({
				...candidate,
				recommendedFramingStrategy: "arbitrary_layout",
				providerSecret: "must-not-cross-boundary",
			}),
		).toThrow();
	});
});
