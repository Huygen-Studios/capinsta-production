import { describe, expect, test } from "bun:test";
import { buildDefaultEffectInstance } from "@/effects";
import { registerDefaultEffects } from "@/effects/definitions";
import { getPaperFoldManifest, validateStyleManifest } from "./assets";
import { buildPaperFoldGpuPass } from "./gpu";
import { resolvePaperFoldTiming } from "./timing";
import {
	normalizePaperFoldParams,
	PAPER_FOLD_DEFAULTS,
	type PaperFoldParams,
	type PaperFoldStyleManifest,
} from "./types";

describe("Paper Fold", () => {
	test("registers with complete serializable defaults", () => {
		registerDefaultEffects();
		const effect = buildDefaultEffectInstance({ effectType: "paper-fold" });
		expect(effect.type).toBe("paper-fold");
		expect(effect.enabled).toBe(true);
		expect(effect.params.mode).toBe("fold-in");
		expect(effect.params.paperColor).toBe(PAPER_FOLD_DEFAULTS.paperColor);
		expect(JSON.parse(JSON.stringify(effect))).toEqual(effect);
	});

	test("normalizes partial and invalid schemas", () => {
		const params = normalizePaperFoldParams({
			mode: "manual",
			progress: 2,
			mediaOpacity: -1,
			foldStyle: "not-a-style",
		});
		expect(params.mode).toBe("manual");
		expect(params.progress).toBe(1);
		expect(params.mediaOpacity).toBe(0);
		expect(params.foldStyle).toBe("center-fold");
		expect(params.schemaVersion).toBe(1);
	});

	test("resolves all animation modes deterministically", () => {
		expect(state({ mode: "fold-in", time: 0 }).progress).toBe(0);
		expect(state({ mode: "fold-in", time: 1 }).progress).toBe(1);
		expect(state({ mode: "fold-out", time: 3 }).progress).toBe(1);
		expect(state({ mode: "fold-out", time: 4 }).progress).toBe(0);
		expect(state({ mode: "fold-in-out", time: 2 }).progress).toBe(1);
		expect(
			state({ mode: "manual", time: 2, patch: { progress: 0.375 } }).progress,
		).toBe(0.375);
	});

	test("reverse, frame hold, posterization, and frame clamping are stable", () => {
		const forward = state({
			mode: "manual",
			time: 2,
			patch: { progress: 0.25 },
		});
		const reverse = state({
			mode: "manual",
			time: 2,
			patch: { progress: 0.25, reverse: true },
		});
		expect(forward.frameIndex).toBe(3);
		expect(reverse.frameIndex).toBe(8);
		const heldA = state({
			mode: "fold-in",
			time: 0.11,
			patch: { frameHold: 3, posterizeFps: 10 },
		});
		const heldB = state({
			mode: "fold-in",
			time: 0.19,
			patch: { frameHold: 3, posterizeFps: 10 },
		});
		expect(heldA.frameIndex).toBe(heldB.frameIndex);
		expect(reverse.frameIndex).toBeLessThan(12);
	});

	test("trim and speed changes do not alter clip-local animation state", () => {
		const trimmedSourceState = state({ mode: "fold-in", time: 0.5 });
		const speedAdjustedSourceState = state({ mode: "fold-in", time: 0.5 });
		expect(speedAdjustedSourceState).toEqual(trimmedSourceState);
	});

	test("preview and export timestamps produce matching states and shake", () => {
		const preview = state({
			mode: "fold-in-out",
			time: 1.25,
			patch: { shakeAmount: 8, shakeFrequency: 12, randomSeed: 991 },
		});
		const exported = state({
			mode: "fold-in-out",
			time: 1.25,
			patch: { shakeAmount: 8, shakeFrequency: 12, randomSeed: 991 },
		});
		expect(exported).toEqual(preview);
	});

	test("validates manifests and missing assets", () => {
		const manifest = getPaperFoldManifest({ styleId: "center-fold" });
		expect(validateStyleManifest({ manifest }).valid).toBe(true);
		const invalid: PaperFoldStyleManifest = {
			...manifest,
			frameCount: 2,
			frames: [{ paper: "", matte: "" }],
		};
		const validation = validateStyleManifest({ manifest: invalid });
		expect(validation.valid).toBe(false);
		expect(validation.errors.length).toBeGreaterThan(0);
	});

	test("builds a paired-atlas GPU pass", () => {
		const runtime = {
			effectId: "effect-1",
			params: PAPER_FOLD_DEFAULTS,
			localTimeSeconds: 0.5,
			durationSeconds: 4,
			timelineFps: 30,
			frameState: state({ mode: "fold-in", time: 0.5 }),
		};
		const pass = buildPaperFoldGpuPass({
			runtime,
			atlasTextureId: "atlas-1",
			columns: 4,
			rows: 3,
			width: 1920,
			height: 1080,
		});
		expect(pass.shader).toBe("paper-fold");
		expect(pass.textures?.u_foldAtlas).toBe("atlas-1");
		expect(pass.uniforms.u_grid).toEqual([4, 3]);
	});
});

function state({
	mode,
	time,
	patch = {},
}: {
	mode: PaperFoldParams["mode"];
	time: number;
	patch?: Partial<PaperFoldParams>;
}) {
	const params = { ...PAPER_FOLD_DEFAULTS, mode, ...patch };
	return resolvePaperFoldTiming({
		localTimeSeconds: time,
		durationSeconds: 4,
		timelineFps: 30,
		frameCount: 12,
		params,
	});
}
