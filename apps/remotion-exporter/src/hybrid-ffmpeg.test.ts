import { describe, expect, test } from "bun:test";
import type { CapInstaRemotionPropsV1 } from "./contracts";
import { atempoChain, buildHybridFfmpegArgs } from "./hybrid-ffmpeg";

const props: CapInstaRemotionPropsV1 = {
	version: 1,
	export: { width: 320, height: 568, fps: 30, quality: "standard", backgroundColor: "#000000" },
	media: { sources: [{ id: "s", url: "/s.mp4", hasAudio: true, accessMode: "localized" }] },
	timeline: { edl: { schemaVersion: 1, clipProjectId: "p", projectRevision: 1, sourceMediaId: "s", sourceDurationMs: 1000, outputDurationMs: 1000, entries: [{ id: "e", rangeId: "r", order: 0, sourceMediaId: "s", sourceStartMs: 0, sourceEndMs: 1000, sourceDurationMs: 1000, outputStartMs: 0, outputEndMs: 1000, outputDurationMs: 1000, playbackRate: 1, transitionIn: null, transitionOut: null, metadata: {} }], warnings: [], metadata: {} } },
};

describe("hybrid FFmpeg plan", () => {
	test("chains playback rates outside atempo's single-filter range", () => {
		expect(atempoChain(4)).toEqual(["atempo=2", "atempo=2"]);
		expect(atempoChain(0.25)).toEqual(["atempo=0.5", "atempo=0.5"]);
	});

	test("video without captions has no overlay input", () => {
		const args = buildHybridFfmpegArgs({ props, base: { type: "video" }, sourceFiles: new Map([["s", "source.mp4"]]), overlay: { type: "none" }, output: "out.mp4" });
		expect(args.filter((value) => value === "-i")).toHaveLength(1);
		expect(args.join(" ")).not.toContain("overlay=");
	});

	test("solid base retains EDL audio and uses explicit straight alpha", () => {
		const args = buildHybridFfmpegArgs({ props, base: { type: "solidColor", color: "#123456" }, sourceFiles: new Map([["s", "source.mp4"]]), overlay: { type: "png", pattern: "overlay-%03d.png" }, output: "out.mp4" });
		const command = args.join(" ");
		expect(command).toContain("color=c=#123456");
		expect(command).toContain("[0:a]atrim");
		expect(command).toContain("alpha=straight");
	});

	test("repeated EDL ranges use independent input cursors to avoid decoder buffering", () => {
		const repeated = { ...props, timeline: { edl: { ...props.timeline.edl, outputDurationMs: 2000, entries: [props.timeline.edl.entries[0]!, { ...props.timeline.edl.entries[0]!, id: "e2", order: 1, outputStartMs: 1000, outputEndMs: 2000 }] } } };
		const args = buildHybridFfmpegArgs({ props: repeated, base: { type: "video" }, sourceFiles: new Map([["s", "source.mp4"]]), overlay: { type: "none" }, output: "out.mp4" });
		expect(args.filter((value) => value === "-i")).toHaveLength(2);
		expect(args.join(" ")).toContain("[0:v]trim");
		expect(args.join(" ")).toContain("[1:v]trim");
	});

	test("silent solid projects require no media input", () => {
		const silent = { ...props, media: { sources: [{ ...props.media.sources[0]!, hasAudio: false }] } };
		const args = buildHybridFfmpegArgs({ props: silent, base: { type: "solidColor", color: "#000000" }, sourceFiles: new Map(), overlay: { type: "none" }, output: "out.mp4" });
		expect(args.filter((value) => value === "-i")).toHaveLength(1);
		expect(args.join(" ")).not.toContain("[0:a]");
	});

	test("input seeking keeps exact range duration and rebases filters", () => {
		const later = { ...props, timeline: { edl: { ...props.timeline.edl, entries: [{ ...props.timeline.edl.entries[0]!, sourceStartMs: 5000, sourceEndMs: 6000 }] } } };
		const args = buildHybridFfmpegArgs({ props: later, base: { type: "video" }, sourceFiles: new Map([["s", "source.mp4"]]), overlay: { type: "none" }, output: "out.mp4", seekInputs: true, threads: 2, preset: "faster" });
		const command = args.join(" ");
		expect(command).toContain("-ss 5.000000 -t 1.000000 -i source.mp4");
		expect(command).toContain("trim=start=0.000000:end=1.000000");
		expect(command).toContain("-preset faster");
		expect(command).toContain("-threads 2");
	});
});
