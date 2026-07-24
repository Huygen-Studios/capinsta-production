import type { EffectPass } from "@/effects/types";
import type { PaperFoldRuntimeState } from "./types";

export function buildPaperFoldGpuPass({
	runtime,
	atlasTextureId,
	columns,
	rows,
	width,
	height,
}: {
	runtime: PaperFoldRuntimeState;
	atlasTextureId: string;
	columns: number;
	rows: number;
	width: number;
	height: number;
}): EffectPass {
	const params = runtime.params;
	const key = color(params.keyColor);
	const tint = color(params.paperColor);
	const shadow = color(params.shadowColor);
	const border = color(params.borderColor);
	const alphaMode =
		params.alphaMode === "luma"
			? 1
			: params.alphaMode === "green-screen"
				? 2
				: 0;
	return {
		shader: "paper-fold",
		textures: { u_foldAtlas: atlasTextureId },
		uniforms: {
			u_frame: runtime.frameState.frameIndex,
			u_grid: [columns, rows],
			u_tint: [...tint, params.paperTintAmount],
			u_appearance: [
				params.paperOpacity,
				params.exposure,
				params.contrast,
				params.saturation,
			],
			u_keyColor: [...key, params.mediaOpacity],
			u_keying: [
				params.keySimilarity,
				params.keySmoothness,
				params.spillSuppression,
				alphaMode,
			],
			u_detail: [
				params.alphaThreshold,
				Math.max(0.001, params.alphaFeather),
				params.halftoneAmount,
				Math.min(1, params.noiseAmount + params.paperTextureAmount * 0.5),
			],
			u_paperTransform: [
				params.paperScale,
				(params.paperRotation * Math.PI) / 180,
				params.paperPositionX / Math.max(1, width),
				params.paperPositionY / Math.max(1, height),
			],
			u_mediaTransform: [
				params.mediaScale,
				(params.mediaRotation * Math.PI) / 180,
				params.mediaPositionX / Math.max(1, width),
				params.mediaPositionY / Math.max(1, height),
			],
			u_overallTransform: [
				params.scale,
				((params.rotation + runtime.frameState.rotationDegrees) * Math.PI) /
					180,
				(params.positionX + runtime.frameState.offsetX) / Math.max(1, width),
				(params.positionY + runtime.frameState.offsetY) / Math.max(1, height),
			],
			u_composite: [
				params.overallOpacity,
				Math.min(1, params.foldIntensity),
				params.flipHorizontal ? 1 : 0,
				params.flipVertical ? 1 : 0,
			],
			u_shadowColor: [
				...shadow,
				params.shadowEnabled ? params.shadowOpacity : 0,
			],
			u_shadow: [
				params.shadowEnabled ? params.shadowOpacity : 0,
				params.shadowDistance,
				(params.shadowAngle * Math.PI) / 180,
				params.mixWithOriginal,
			],
			u_borderColor: [...border, params.borderEnabled ? 1 : 0],
			u_border: [params.borderWidth, params.borderEnabled ? 1 : 0],
		},
	};
}

function color(value: string): [number, number, number] {
	const normalized = value.replace(/^#/, "");
	if (!/^[0-9a-f]{6}$/i.test(normalized)) return [1, 1, 1];
	return [
		Number.parseInt(normalized.slice(0, 2), 16) / 255,
		Number.parseInt(normalized.slice(2, 4), 16) / 255,
		Number.parseInt(normalized.slice(4, 6), 16) / 255,
	];
}
