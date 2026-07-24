/* eslint-disable opencut/prefer-object-params, @typescript-eslint/no-unsafe-type-assertion -- compact, typed DSL for a long declarative control list */
import type { EffectDefinition } from "@/effects/types";
import type { ParamDefinition } from "@/params";
import {
	PAPER_FOLD_DEFAULTS as d,
	PAPER_FOLD_EFFECT_TYPE,
} from "@/effects/paper-fold/types";

const number = (
	key: keyof typeof d,
	label: string,
	min: number,
	max: number,
	step: number,
	options: Partial<ParamDefinition> = {},
): ParamDefinition =>
	({
		key,
		label,
		type: "number",
		default: d[key] as number,
		min,
		max,
		step,
		...options,
	}) as ParamDefinition;

const boolean = (
	key: keyof typeof d,
	label: string,
	options: Partial<ParamDefinition> = {},
): ParamDefinition =>
	({
		key,
		label,
		type: "boolean",
		default: d[key] as boolean,
		...options,
	}) as ParamDefinition;

const color = (key: keyof typeof d, label: string): ParamDefinition => ({
	key,
	label,
	type: "color",
	default: d[key] as string,
});

const select = (
	key: keyof typeof d,
	label: string,
	options: Array<{ value: string; label: string }>,
): ParamDefinition => ({
	key,
	label,
	type: "select",
	default: d[key] as string,
	options,
});

export const paperFoldEffectDefinition: EffectDefinition = {
	type: PAPER_FOLD_EFFECT_TYPE,
	name: "Paper Fold",
	keywords: ["animation", "stylize", "paper", "fold", "unfold", "origami"],
	params: [
		select("mode", "Mode", [
			{ value: "fold-in", label: "Fold In" },
			{ value: "fold-out", label: "Fold Out" },
			{ value: "fold-in-out", label: "Fold In and Out" },
			{ value: "manual", label: "Manual" },
		]),
		number("progress", "Progress", 0, 1, 0.01, {
			unit: "percent",
			dependencies: [{ param: "mode", equals: "manual" }],
		}),
		number("inDuration", "In Duration", 0, 60, 0.05),
		number("outDuration", "Out Duration", 0, 60, 0.05),
		number("holdDuration", "Hold Duration", 0, 60, 0.05),
		boolean("reverse", "Reverse"),
		number("frameHold", "Frame Hold", 1, 120, 1),
		number("posterizeFps", "Posterize FPS", 0, 240, 1),
		number("animationOffset", "Animation Offset", -60, 60, 0.01),
		number("randomSeed", "Random Seed", 0, 2147483647, 1),
		select("foldStyle", "Fold Style", [
			{ value: "center-fold", label: "Center Fold" },
			{ value: "corner-fold", label: "Corner Fold" },
			{ value: "envelope-fold", label: "Envelope Fold" },
			{ value: "crumple-fold", label: "Crumple Fold" },
		]),
		select("foldDirection", "Fold Direction", [
			{ value: "left", label: "Left" },
			{ value: "right", label: "Right" },
			{ value: "up", label: "Up" },
			{ value: "down", label: "Down" },
		]),
		select("foldOrigin", "Fold Origin", [
			{ value: "center", label: "Center" },
			{ value: "top-left", label: "Top Left" },
			{ value: "top-right", label: "Top Right" },
			{ value: "bottom-left", label: "Bottom Left" },
			{ value: "bottom-right", label: "Bottom Right" },
		]),
		number("foldIntensity", "Fold Intensity", 0, 2, 0.01),
		number("paperScale", "Paper Scale", 0.01, 10, 0.01),
		number("paperRotation", "Paper Rotation", -360, 360, 0.1),
		number("paperPositionX", "Paper Position X", -2000, 2000, 1),
		number("paperPositionY", "Paper Position Y", -2000, 2000, 1),
		boolean("flipHorizontal", "Flip Horizontal"),
		boolean("flipVertical", "Flip Vertical"),
		number("mediaScale", "Media Scale", 0.01, 10, 0.01),
		number("mediaRotation", "Media Rotation", -360, 360, 0.1),
		number("mediaPositionX", "Media Position X", -2000, 2000, 1),
		number("mediaPositionY", "Media Position Y", -2000, 2000, 1),
		number("mediaOpacity", "Media Opacity", 0, 1, 0.01, {
			unit: "percent",
		}),
		select("fitMode", "Fit Mode", [
			{ value: "contain", label: "Contain" },
			{ value: "cover", label: "Cover" },
			{ value: "stretch", label: "Stretch" },
		]),
		select("alphaMode", "Alpha Mode", [
			{ value: "source-alpha", label: "Source Alpha" },
			{ value: "luma", label: "Luma" },
			{ value: "green-screen", label: "Green Screen" },
		]),
		color("keyColor", "Key Color"),
		number("keySimilarity", "Key Similarity", 0, 1, 0.01),
		number("keySmoothness", "Key Smoothness", 0, 1, 0.01),
		number("spillSuppression", "Spill Suppression", 0, 1, 0.01),
		number("alphaThreshold", "Alpha Threshold", 0, 1, 0.01),
		number("alphaFeather", "Alpha Feather", 0, 1, 0.01),
		color("paperColor", "Paper Color"),
		number("paperTintAmount", "Paper Tint Amount", 0, 1, 0.01),
		number("paperTextureAmount", "Paper Texture Amount", 0, 1, 0.01),
		number("paperOpacity", "Paper Opacity", 0, 1, 0.01, {
			unit: "percent",
		}),
		number("exposure", "Exposure", -5, 5, 0.05),
		number("contrast", "Contrast", 0, 4, 0.01),
		number("saturation", "Saturation", 0, 4, 0.01),
		number("noiseAmount", "Noise Amount", 0, 1, 0.01),
		number("halftoneAmount", "Halftone Amount", 0, 1, 0.01),
		boolean("borderEnabled", "Border Enabled"),
		number("borderWidth", "Border Width", 0, 200, 1),
		color("borderColor", "Border Color"),
		boolean("shadowEnabled", "Shadow Enabled"),
		color("shadowColor", "Shadow Color"),
		number("shadowOpacity", "Shadow Opacity", 0, 1, 0.01, {
			unit: "percent",
		}),
		number("shadowBlur", "Shadow Blur", 0, 500, 1),
		number("shadowDistance", "Shadow Distance", 0, 1000, 1),
		number("shadowAngle", "Shadow Angle", -360, 360, 1),
		number("positionX", "Position X", -2000, 2000, 1),
		number("positionY", "Position Y", -2000, 2000, 1),
		number("scale", "Scale", 0.01, 10, 0.01),
		number("rotation", "Rotation", -360, 360, 0.1),
		number("shakeAmount", "Shake Amount", 0, 1000, 0.1),
		number("shakeFrequency", "Shake Frequency", 0.01, 240, 0.1),
		number("overallOpacity", "Overall Opacity", 0, 1, 0.01, {
			unit: "percent",
		}),
		number("mixWithOriginal", "Mix With Original", 0, 1, 0.01, {
			unit: "percent",
		}),
	],
	renderer: { passes: [] },
};
