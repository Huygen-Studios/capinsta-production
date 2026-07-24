/* eslint-disable opencut/prefer-object-params, @typescript-eslint/no-unsafe-type-assertion -- schema normalizer validates asserted primitives and enum values */
import type { ParamValues } from "@/params";

export const PAPER_FOLD_EFFECT_TYPE = "paper-fold";
export const PAPER_FOLD_SCHEMA_VERSION = 1;

export type PaperFoldMode = "fold-in" | "fold-out" | "fold-in-out" | "manual";
export type PaperFoldStyleId =
	| "center-fold"
	| "corner-fold"
	| "envelope-fold"
	| "crumple-fold";
export type PaperFoldFitMode = "contain" | "cover" | "stretch";
export type PaperFoldAlphaMode = "source-alpha" | "luma" | "green-screen";

export interface PaperFoldParams {
	schemaVersion: number;
	mode: PaperFoldMode;
	progress: number;
	inDuration: number;
	outDuration: number;
	holdDuration: number;
	reverse: boolean;
	frameHold: number;
	posterizeFps: number;
	animationOffset: number;
	randomSeed: number;
	foldStyle: PaperFoldStyleId;
	foldDirection: "left" | "right" | "up" | "down";
	foldOrigin:
		| "center"
		| "top-left"
		| "top-right"
		| "bottom-left"
		| "bottom-right";
	foldIntensity: number;
	paperScale: number;
	paperRotation: number;
	paperPositionX: number;
	paperPositionY: number;
	flipHorizontal: boolean;
	flipVertical: boolean;
	mediaScale: number;
	mediaRotation: number;
	mediaPositionX: number;
	mediaPositionY: number;
	mediaOpacity: number;
	fitMode: PaperFoldFitMode;
	alphaMode: PaperFoldAlphaMode;
	keyColor: string;
	keySimilarity: number;
	keySmoothness: number;
	spillSuppression: number;
	alphaThreshold: number;
	alphaFeather: number;
	paperColor: string;
	paperTintAmount: number;
	paperTextureAmount: number;
	paperOpacity: number;
	exposure: number;
	contrast: number;
	saturation: number;
	noiseAmount: number;
	halftoneAmount: number;
	borderEnabled: boolean;
	borderWidth: number;
	borderColor: string;
	shadowEnabled: boolean;
	shadowColor: string;
	shadowOpacity: number;
	shadowBlur: number;
	shadowDistance: number;
	shadowAngle: number;
	positionX: number;
	positionY: number;
	scale: number;
	rotation: number;
	shakeAmount: number;
	shakeFrequency: number;
	overallOpacity: number;
	mixWithOriginal: number;
}

export interface PaperFoldFrameManifest {
	paper: string;
	matte: string;
}

export interface PaperFoldStyleManifest {
	id: PaperFoldStyleId;
	name: string;
	version: number;
	width: number;
	height: number;
	frameCount: number;
	frames: PaperFoldFrameManifest[];
	defaultDirection?: PaperFoldParams["foldDirection"];
	supportsReverse: boolean;
	assetKind: "generated-placeholder";
	replacementNotice: string;
}

export interface PaperFoldFrameState {
	progress: number;
	frameIndex: number;
	offsetX: number;
	offsetY: number;
	rotationDegrees: number;
}

export interface PaperFoldRuntimeState {
	effectId: string;
	params: PaperFoldParams;
	localTimeSeconds: number;
	durationSeconds: number;
	timelineFps: number;
	frameState: PaperFoldFrameState;
}

export const PAPER_FOLD_DEFAULTS: PaperFoldParams = {
	schemaVersion: PAPER_FOLD_SCHEMA_VERSION,
	mode: "fold-in",
	progress: 1,
	inDuration: 0.75,
	outDuration: 0.75,
	holdDuration: 0,
	reverse: false,
	frameHold: 1,
	posterizeFps: 0,
	animationOffset: 0,
	randomSeed: 1,
	foldStyle: "center-fold",
	foldDirection: "right",
	foldOrigin: "center",
	foldIntensity: 0.75,
	paperScale: 1,
	paperRotation: 0,
	paperPositionX: 0,
	paperPositionY: 0,
	flipHorizontal: false,
	flipVertical: false,
	mediaScale: 1,
	mediaRotation: 0,
	mediaPositionX: 0,
	mediaPositionY: 0,
	mediaOpacity: 1,
	fitMode: "stretch",
	alphaMode: "source-alpha",
	keyColor: "#00ff00",
	keySimilarity: 0.32,
	keySmoothness: 0.12,
	spillSuppression: 0.5,
	alphaThreshold: 0,
	alphaFeather: 0.08,
	paperColor: "#f2ead8",
	paperTintAmount: 0.2,
	paperTextureAmount: 0.18,
	paperOpacity: 1,
	exposure: 0,
	contrast: 1,
	saturation: 1,
	noiseAmount: 0.04,
	halftoneAmount: 0,
	borderEnabled: false,
	borderWidth: 3,
	borderColor: "#ffffff",
	shadowEnabled: true,
	shadowColor: "#000000",
	shadowOpacity: 0.35,
	shadowBlur: 12,
	shadowDistance: 8,
	shadowAngle: 45,
	positionX: 0,
	positionY: 0,
	scale: 1,
	rotation: 0,
	shakeAmount: 0,
	shakeFrequency: 12,
	overallOpacity: 1,
	mixWithOriginal: 0,
};

export function normalizePaperFoldParams(values: ParamValues): PaperFoldParams {
	const defaults = PAPER_FOLD_DEFAULTS;
	const number = (key: keyof PaperFoldParams, min: number, max: number) => {
		const value = values[key];
		return typeof value === "number" && Number.isFinite(value)
			? Math.min(max, Math.max(min, value))
			: (defaults[key] as number);
	};
	const boolean = (key: keyof PaperFoldParams) =>
		typeof values[key] === "boolean"
			? (values[key] as boolean)
			: (defaults[key] as boolean);
	const string = <T extends string>(
		key: keyof PaperFoldParams,
		allowed?: readonly T[],
	): T => {
		const value = values[key];
		return typeof value === "string" &&
			(!allowed || allowed.includes(value as T))
			? (value as T)
			: (defaults[key] as T);
	};

	return {
		schemaVersion: PAPER_FOLD_SCHEMA_VERSION,
		mode: string("mode", ["fold-in", "fold-out", "fold-in-out", "manual"]),
		progress: number("progress", 0, 1),
		inDuration: number("inDuration", 0, 60),
		outDuration: number("outDuration", 0, 60),
		holdDuration: number("holdDuration", 0, 60),
		reverse: boolean("reverse"),
		frameHold: Math.round(number("frameHold", 1, 120)),
		posterizeFps: number("posterizeFps", 0, 240),
		animationOffset: number("animationOffset", -60, 60),
		randomSeed: Math.round(number("randomSeed", 0, 0x7fffffff)),
		foldStyle: string("foldStyle", [
			"center-fold",
			"corner-fold",
			"envelope-fold",
			"crumple-fold",
		]),
		foldDirection: string("foldDirection", ["left", "right", "up", "down"]),
		foldOrigin: string("foldOrigin", [
			"center",
			"top-left",
			"top-right",
			"bottom-left",
			"bottom-right",
		]),
		foldIntensity: number("foldIntensity", 0, 2),
		paperScale: number("paperScale", 0.01, 10),
		paperRotation: number("paperRotation", -3600, 3600),
		paperPositionX: number("paperPositionX", -10000, 10000),
		paperPositionY: number("paperPositionY", -10000, 10000),
		flipHorizontal: boolean("flipHorizontal"),
		flipVertical: boolean("flipVertical"),
		mediaScale: number("mediaScale", 0.01, 10),
		mediaRotation: number("mediaRotation", -3600, 3600),
		mediaPositionX: number("mediaPositionX", -10000, 10000),
		mediaPositionY: number("mediaPositionY", -10000, 10000),
		mediaOpacity: number("mediaOpacity", 0, 1),
		fitMode: string("fitMode", ["contain", "cover", "stretch"]),
		alphaMode: string("alphaMode", ["source-alpha", "luma", "green-screen"]),
		keyColor: string("keyColor"),
		keySimilarity: number("keySimilarity", 0, 1),
		keySmoothness: number("keySmoothness", 0, 1),
		spillSuppression: number("spillSuppression", 0, 1),
		alphaThreshold: number("alphaThreshold", 0, 1),
		alphaFeather: number("alphaFeather", 0, 1),
		paperColor: string("paperColor"),
		paperTintAmount: number("paperTintAmount", 0, 1),
		paperTextureAmount: number("paperTextureAmount", 0, 1),
		paperOpacity: number("paperOpacity", 0, 1),
		exposure: number("exposure", -5, 5),
		contrast: number("contrast", 0, 4),
		saturation: number("saturation", 0, 4),
		noiseAmount: number("noiseAmount", 0, 1),
		halftoneAmount: number("halftoneAmount", 0, 1),
		borderEnabled: boolean("borderEnabled"),
		borderWidth: number("borderWidth", 0, 200),
		borderColor: string("borderColor"),
		shadowEnabled: boolean("shadowEnabled"),
		shadowColor: string("shadowColor"),
		shadowOpacity: number("shadowOpacity", 0, 1),
		shadowBlur: number("shadowBlur", 0, 500),
		shadowDistance: number("shadowDistance", 0, 1000),
		shadowAngle: number("shadowAngle", -3600, 3600),
		positionX: number("positionX", -10000, 10000),
		positionY: number("positionY", -10000, 10000),
		scale: number("scale", 0.01, 10),
		rotation: number("rotation", -3600, 3600),
		shakeAmount: number("shakeAmount", 0, 1000),
		shakeFrequency: number("shakeFrequency", 0.01, 240),
		overallOpacity: number("overallOpacity", 0, 1),
		mixWithOriginal: number("mixWithOriginal", 0, 1),
	};
}
