import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { CapInstaRemotionPropsV1 } from "./contracts";
import { verifyOutput } from "./verify";

let directory = "";
let output = "";

const props: CapInstaRemotionPropsV1 = {
	version: 1,
	export: { width: 320, height: 568, fps: 30, quality: "standard", backgroundColor: "#000000" },
	media: { sources: [{ id: "source", url: "fixture.mp4", hasAudio: false, accessMode: "localized" }] },
	timeline: { edl: {
		schemaVersion: 1, clipProjectId: "verify", projectRevision: 1, sourceMediaId: "source", sourceDurationMs: 1000, outputDurationMs: 1000,
		entries: [{ id: "entry", rangeId: "range", order: 0, sourceMediaId: "source", sourceStartMs: 0, sourceEndMs: 1000, sourceDurationMs: 1000, outputStartMs: 0, outputEndMs: 1000, outputDurationMs: 1000, playbackRate: 1, transitionIn: null, transitionOut: null, metadata: {} }],
		warnings: [], metadata: {},
	} },
};

beforeAll(async () => {
	directory = await mkdtemp(resolve(tmpdir(), "capinsta-remotion-verify-"));
	output = resolve(directory, "valid.mp4");
	const result = Bun.spawnSync(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x568:rate=30:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", output]);
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
});

afterAll(async () => rm(directory, { recursive: true, force: true }));

describe("rendered output verification", () => {
	test("accepts matching H.264 dimensions, rate, and duration", async () => {
		const verified = await verifyOutput(output, props);
		expect(verified).toMatchObject({ codec: "h264", width: 320, height: 568, fps: 30, frameCount: 30, durationSeconds: 1 });
	});

	test("rejects a composition contract mismatch", async () => {
		await expect(verifyOutput(output, { ...props, export: { ...props.export, width: 322 } })).rejects.toThrow("OUTPUT_INVALID");
	});
});
