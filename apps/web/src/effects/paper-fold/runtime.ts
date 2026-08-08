import { frameRateToFloat } from "@/fps/utils";
import { mediaTimeToSeconds, roundMediaTime } from "@/wasm";
import { resolveEffectParamsAtTime } from "@/animation/effect-param-channel";
import type { Effect } from "@/effects/types";
import type { VisualNodeParams } from "@/services/renderer/nodes/visual-node";
import { getPaperFoldManifest } from "./assets";
import { resolvePaperFoldTiming } from "./timing";
import {
	normalizePaperFoldParams,
	PAPER_FOLD_EFFECT_TYPE,
	type PaperFoldRuntimeState,
} from "./types";
import type { FrameRate } from "opencut-wasm";

export function resolvePaperFoldRuntime({
	effects,
	animations,
	localTime,
	duration,
	fps,
}: {
	effects: Effect[] | undefined;
	animations: VisualNodeParams["animations"];
	localTime: number;
	duration: number;
	fps: FrameRate;
}): PaperFoldRuntimeState | null {
	const effect = effects?.find(
		(candidate) =>
			candidate.enabled && candidate.type === PAPER_FOLD_EFFECT_TYPE,
	);
	if (!effect) return null;
	const resolvedValues = resolveEffectParamsAtTime({
		effectId: effect.id,
		params: effect.params,
		animations,
		localTime,
	});
	const params = normalizePaperFoldParams(resolvedValues);
	const manifest = getPaperFoldManifest({ styleId: params.foldStyle });
	const localTimeSeconds = mediaTimeToSeconds({
		time: roundMediaTime({ time: localTime }),
	});
	const durationSeconds = mediaTimeToSeconds({
		time: roundMediaTime({ time: duration }),
	});
	const timelineFps = frameRateToFloat(fps);
	return {
		effectId: effect.id,
		params,
		localTimeSeconds,
		durationSeconds,
		timelineFps,
		frameState: resolvePaperFoldTiming({
			localTimeSeconds,
			durationSeconds,
			timelineFps,
			frameCount: manifest.frameCount,
			params,
		}),
	};
}

export function withoutPaperFoldPassGroups<T>(groups: T[][]): T[][] {
	return groups.filter((group) => group.length > 0);
}
