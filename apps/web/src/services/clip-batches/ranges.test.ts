import { describe, expect, test } from "bun:test";
import { adjustClipRange, initialClipRanges } from "./ranges";

describe.skipIf(process.platform === "win32")("manual clip ranges", () => {
	test("creates deterministic independent ranges bounded to three minutes", () => {
		const ranges = initialClipRanges({
			sourceDurationMs: 30 * 60_000,
			count: 5,
		});
		expect(ranges).toHaveLength(5);
		expect(ranges[0]).toEqual({ sourceStartMs: 0, sourceEndMs: 180_000 });
		expect(ranges[4]).toEqual({
			sourceStartMs: 1_440_000,
			sourceEndMs: 1_620_000,
		});
		expect(
			ranges.every(
				(range) => range.sourceEndMs - range.sourceStartMs <= 180_000,
			),
		).toBe(true);
	});

	test("rejects unsupported counts", () => {
		expect(() =>
			initialClipRanges({ sourceDurationMs: 60_000, count: 0 }),
		).toThrow();
		expect(() =>
			initialClipRanges({ sourceDurationMs: 60_000, count: 13 }),
		).toThrow();
	});

	test("adjusts either edge or moves the body without changing its duration", () => {
		const range = { sourceStartMs: 10_000, sourceEndMs: 20_000 };
		expect(
			adjustClipRange({
				range,
				mode: "start",
				deltaMs: 1_000,
				sourceDurationMs: 30_000,
			}),
		).toEqual({ sourceStartMs: 11_000, sourceEndMs: 20_000 });
		expect(
			adjustClipRange({
				range,
				mode: "end",
				deltaMs: -1_000,
				sourceDurationMs: 30_000,
			}),
		).toEqual({ sourceStartMs: 10_000, sourceEndMs: 19_000 });
		expect(
			adjustClipRange({
				range,
				mode: "body",
				deltaMs: 50_000,
				sourceDurationMs: 30_000,
			}),
		).toEqual({ sourceStartMs: 20_000, sourceEndMs: 30_000 });
	});

	test("clamps edge changes to source bounds and three minutes", () => {
		const range = { sourceStartMs: 200_000, sourceEndMs: 210_000 };
		expect(
			adjustClipRange({
				range,
				mode: "start",
				deltaMs: -500_000,
				sourceDurationMs: 300_000,
			}),
		).toEqual({ sourceStartMs: 30_000, sourceEndMs: 210_000 });
		expect(
			adjustClipRange({
				range,
				mode: "end",
				deltaMs: 500_000,
				sourceDurationMs: 300_000,
			}),
		).toEqual({ sourceStartMs: 200_000, sourceEndMs: 300_000 });
	});
});
