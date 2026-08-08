import { resolvePaperFoldFrameState } from "opencut-wasm";
import type { PaperFoldFrameState, PaperFoldParams } from "./types";

export function resolvePaperFoldTiming({
	localTimeSeconds,
	durationSeconds,
	timelineFps,
	frameCount,
	params,
}: {
	localTimeSeconds: number;
	durationSeconds: number;
	timelineFps: number;
	frameCount: number;
	params: PaperFoldParams;
}): PaperFoldFrameState {
	const state: unknown = resolvePaperFoldFrameState({
		localTimeSeconds,
		durationSeconds,
		timelineFps,
		frameCount,
		mode: params.mode,
		progress: params.progress,
		inDuration: params.inDuration,
		outDuration: params.outDuration,
		holdDuration: params.holdDuration,
		reverse: params.reverse,
		frameHold: params.frameHold,
		posterizeFps: params.posterizeFps,
		animationOffset: params.animationOffset,
		randomSeed: params.randomSeed,
		shakeAmount: params.shakeAmount,
		shakeFrequency: params.shakeFrequency,
	});
	if (
		typeof state === "object" &&
		state !== null &&
		"progress" in state &&
		typeof state.progress === "number" &&
		"frameIndex" in state &&
		typeof state.frameIndex === "number" &&
		"offsetX" in state &&
		typeof state.offsetX === "number" &&
		"offsetY" in state &&
		typeof state.offsetY === "number" &&
		"rotationDegrees" in state &&
		typeof state.rotationDegrees === "number"
	) {
		return {
			progress: state.progress,
			frameIndex: state.frameIndex,
			offsetX: state.offsetX,
			offsetY: state.offsetY,
			rotationDegrees: state.rotationDegrees,
		};
	}
	throw new Error("Paper Fold timing resolver returned an invalid result");
}
