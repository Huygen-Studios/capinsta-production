import { describe, expect, test } from "bun:test";
import { resolveTemplateVideoSourceTimeSeconds } from "@/templates";

const ticks = ({ seconds }: { seconds: number }) => seconds * 120_000;

describe("motion template video source timing", () => {
	test("loops deterministically within source range", () => {
		const binding = {
			mediaId: "video-1",
			sourceStart: ticks({ seconds: 2 }),
			sourceEnd: ticks({ seconds: 5 }),
			playbackMode: "loop" as const,
		};
		expect(
			resolveTemplateVideoSourceTimeSeconds({
				binding,
				assetDurationSeconds: 10,
				localTimeSeconds: 4,
			}),
		).toBe(3);
		expect(
			resolveTemplateVideoSourceTimeSeconds({
				binding,
				assetDurationSeconds: 10,
				localTimeSeconds: -0.5,
			}),
		).toBe(4.5);
	});

	test("freezes and trims safely", () => {
		const binding = {
			mediaId: "video-1",
			sourceStart: ticks({ seconds: 1 }),
			sourceEnd: ticks({ seconds: 3 }),
		};
		expect(
			resolveTemplateVideoSourceTimeSeconds({
				binding: { ...binding, playbackMode: "freeze" },
				assetDurationSeconds: 10,
				localTimeSeconds: 5,
			}),
		).toBe(3);
		expect(
			resolveTemplateVideoSourceTimeSeconds({
				binding: { ...binding, playbackMode: "trim" },
				assetDurationSeconds: 10,
				localTimeSeconds: 5,
			}),
		).toBeNull();
	});

	test("rejects zero or reversed ranges", () => {
		expect(
			resolveTemplateVideoSourceTimeSeconds({
				binding: {
					mediaId: "video-1",
					sourceStart: ticks({ seconds: 3 }),
					sourceEnd: ticks({ seconds: 3 }),
				},
				assetDurationSeconds: 10,
				localTimeSeconds: 0,
			}),
		).toBeNull();
		expect(
			resolveTemplateVideoSourceTimeSeconds({
				binding: {
					mediaId: "video-1",
					sourceStart: ticks({ seconds: 4 }),
					sourceEnd: ticks({ seconds: 2 }),
				},
				assetDurationSeconds: 10,
				localTimeSeconds: 0,
			}),
		).toBeNull();
	});

	test("handles exact boundaries and invalid numeric inputs deterministically", () => {
		const binding = {
			mediaId: "video-1",
			sourceStart: ticks({ seconds: 2 }),
			sourceEnd: ticks({ seconds: 4 }),
			playbackMode: "loop" as const,
		};
		expect(
			resolveTemplateVideoSourceTimeSeconds({
				binding,
				assetDurationSeconds: 10,
				localTimeSeconds: 0,
			}),
		).toBe(2);
		expect(
			resolveTemplateVideoSourceTimeSeconds({
				binding,
				assetDurationSeconds: 10,
				localTimeSeconds: 2,
			}),
		).toBe(2);
		expect(
			resolveTemplateVideoSourceTimeSeconds({
				binding: { ...binding, playbackMode: "freeze" },
				assetDurationSeconds: 10,
				localTimeSeconds: 100,
			}),
		).toBe(4);
		expect(
			resolveTemplateVideoSourceTimeSeconds({
				binding: { ...binding, playbackMode: "trim" },
				assetDurationSeconds: 10,
				localTimeSeconds: 2,
			}),
		).toBe(4);
		expect(
			resolveTemplateVideoSourceTimeSeconds({
				binding: { ...binding, playbackMode: "trim" },
				assetDurationSeconds: 10,
				localTimeSeconds: 2.001,
			}),
		).toBeNull();
		for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(
				resolveTemplateVideoSourceTimeSeconds({
					binding,
					assetDurationSeconds: 10,
					localTimeSeconds: value,
				}),
			).toBeNull();
		}
		expect(
			resolveTemplateVideoSourceTimeSeconds({
				binding: { mediaId: "video-1", playbackMode: "loop" },
				assetDurationSeconds: undefined,
				localTimeSeconds: 1,
			}),
		).toBeNull();
	});
});
