import { expect, test } from "bun:test";
import { ProgressSampler } from "./progress";

test("progress conversion samples five-percent buckets and preserves renderer counters", () => {
	const sampler = new ProgressSampler(() => 900);
	const first = { progress: 0.01, renderedFrames: 9, encodedFrames: 0, renderedDoneIn: null, encodedDoneIn: null, renderEstimatedTime: 1000, stitchStage: "encoding" as const };
	expect(sampler.shouldLog(first)).toBe(true);
	expect(sampler.shouldLog({ ...first, progress: 0.04 })).toBe(false);
	expect(sampler.shouldLog({ ...first, progress: 0.05 })).toBe(true);
	expect(sampler.convert(first)).toMatchObject({ event: "remotion_render_progress", totalFrames: 900, renderedFrames: 9 });
});
