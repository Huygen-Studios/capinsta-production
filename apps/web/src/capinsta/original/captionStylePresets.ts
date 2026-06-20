/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Transplanted original preset registry uses Object.fromEntries to mirror source behavior. */
import {
	DEFAULT_WORD_HIGHLIGHT_BOX_CONFIG,
	MODERN_MINIMALIST_BASE_CONFIG,
	normalizeCaptionStyleConfig,
	normalizeModernMinimalistStyleConfig,
} from "./captionStyleConfig";
import { DEFAULT_CAPTION_CHUNKING_CONFIG } from "./captionUtils";
import {
	CaptionChunkingConfig,
	CaptionStyleConfig,
	CaptionStylePresetId,
} from "./types";

export interface CaptionPresetDefinition {
	id: CaptionStylePresetId;
	name: string;
	description: string;
	previewText: string;
	renderer: CaptionStylePresetId;
	defaultStyleConfig: CaptionStyleConfig;
	defaultChunkingConfig: CaptionChunkingConfig;
	supportedControls: string[];
}

export type CaptionPresetCapability = {
	background: boolean;
	backgroundBorder: boolean;
	textOutline: boolean;
	textShadow: boolean;
	transitions: boolean;
	maxLines: boolean;
	asymmetricScale: boolean;
	editorialFonts: boolean;
};

export const PRESET_CAPABILITIES: Record<
	CaptionStylePresetId,
	CaptionPresetCapability
> = {
	word_highlight_box: {
		background: true,
		backgroundBorder: true,
		textOutline: true,
		textShadow: true,
		transitions: true,
		maxLines: true,
		asymmetricScale: true,
		editorialFonts: false,
	},
	kinetic_fade: {
		background: false,
		backgroundBorder: false,
		textOutline: true,
		textShadow: true,
		transitions: true,
		maxLines: true,
		asymmetricScale: true,
		editorialFonts: false,
	},
	attention_punch: {
		background: false,
		backgroundBorder: false,
		textOutline: true,
		textShadow: true,
		transitions: true,
		maxLines: true,
		asymmetricScale: true,
		editorialFonts: false,
	},
	mrbeast_style: {
		background: false,
		backgroundBorder: false,
		textOutline: true,
		textShadow: true,
		transitions: true,
		maxLines: true,
		asymmetricScale: true,
		editorialFonts: false,
	},
	apple_cinematic: {
		background: false,
		backgroundBorder: false,
		textOutline: true,
		textShadow: true,
		transitions: true,
		maxLines: true,
		asymmetricScale: false,
		editorialFonts: false,
	},
	modern_minimalist_lockup: {
		background: false,
		backgroundBorder: false,
		textOutline: true,
		textShadow: true,
		transitions: true,
		maxLines: false,
		asymmetricScale: false,
		editorialFonts: true,
	},
};

function chunkingConfig(
	overrides: Partial<CaptionChunkingConfig>,
): CaptionChunkingConfig {
	return {
		...DEFAULT_CAPTION_CHUNKING_CONFIG,
		...overrides,
	};
}

export const CAPTION_PRESET_REGISTRY: Record<
	CaptionStylePresetId,
	CaptionPresetDefinition
> = {
	word_highlight_box: {
		id: "word_highlight_box",
		name: "Word Highlight Box",
		description: "Clean creator captions with active-word highlighting.",
		previewText: "word highlight",
		renderer: "word_highlight_box",
		defaultStyleConfig: DEFAULT_WORD_HIGHLIGHT_BOX_CONFIG,
		defaultChunkingConfig: DEFAULT_CAPTION_CHUNKING_CONFIG,
		supportedControls: [
			"font",
			"size",
			"colors",
			"background",
			"position",
			"animation",
		],
	},
	kinetic_fade: {
		id: "kinetic_fade",
		name: "Kinetic Fade",
		description: "Smooth word reveal with lightweight motion.",
		previewText: "smooth fade",
		renderer: "kinetic_fade",
		defaultStyleConfig: normalizeCaptionStyleConfig({
			presetName: "Kinetic Fade",
			fontFamily: "Poppins",
			bigFontFamily: "Poppins",
			smallFontFamily: "Poppins",
			fontSize: 56,
			fontWeight: 800,
			textColor: "#FFFFFF",
			activeWordColor: "#BDE0FF",
			backgroundEnabled: false,
			backgroundOpacity: 0,
			borderRadius: 8,
			paddingX: 14,
			paddingY: 8,
			lineHeight: 1.08,
			textTransform: "none",
			textShadowEnabled: false,
			textStrokeEnabled: false,
			textShadowColor: "#000000",
			textShadowOpacity: 0.3,
			textShadowBlur: 8,
			textShadowDistance: 4,
			textShadowAngle: 45,
			activeWordScale: 1.02,
			activeWordGlow: false,
			activeWordBackgroundEnabled: false,
			wordEffect: "fade",
			animationType: "none",
			animationStrength: 0.45,
			animationSpeed: 1,
			animationSmoothness: 0.85,
			entranceAnimation: "fade",
			backgroundShadow: false,
			positionX: 50,
			positionY: 76,
			scale: 1,
			rotation: 0,
			opacity: 1,
			alignment: "center",
			maxWidth: 88,
		}),
		defaultChunkingConfig: DEFAULT_CAPTION_CHUNKING_CONFIG,
		supportedControls: ["font", "size", "colors", "position", "reveal"],
	},
	attention_punch: {
		id: "attention_punch",
		name: "Attention Punch",
		description: "Bold outlined words with punchy active-word emphasis.",
		previewText: "PUNCH",
		renderer: "attention_punch",
		defaultStyleConfig: normalizeCaptionStyleConfig({
			presetName: "Attention Punch",
			fontFamily: "Tactic",
			bigFontFamily: "Tactic",
			smallFontFamily: "Tactic",
			fontSize: 64,
			fontWeight: 900,
			textColor: "#FFFFFF",
			activeWordColor: "#FFD43B",
			backgroundEnabled: false,
			backgroundOpacity: 0,
			borderRadius: 4,
			paddingX: 10,
			paddingY: 4,
			lineHeight: 0.98,
			textTransform: "uppercase",
			textShadowEnabled: false,
			textStrokeEnabled: true,
			textStrokeColor: "#050505",
			textStrokeWidth: 2,
			textShadowColor: "#000000",
			textShadowOpacity: 0.3,
			textShadowBlur: 8,
			textShadowDistance: 4,
			textShadowAngle: 45,
			activeWordScale: 1.1,
			activeWordGlow: true,
			activeWordBackgroundEnabled: false,
			wordEffect: "pop",
			animationType: "pop",
			animationStrength: 0.9,
			animationSpeed: 1.15,
			animationSmoothness: 0.35,
			entranceAnimation: "pop",
			backgroundShadow: false,
			positionX: 50,
			positionY: 77,
			scale: 1,
			rotation: 0,
			opacity: 1,
			alignment: "center",
			maxWidth: 90,
		}),
		defaultChunkingConfig: DEFAULT_CAPTION_CHUNKING_CONFIG,
		supportedControls: ["font", "stroke", "shadow", "position", "pop"],
	},
	mrbeast_style: {
		id: "mrbeast_style",
		name: "MrBeast Style",
		description:
			"1-2 word all-caps captions with heavy stroke, smart colors, and mechanical pop.",
		previewText: "FLASHY POP",
		renderer: "mrbeast_style",
		defaultStyleConfig: normalizeCaptionStyleConfig({
			presetName: "MrBeast Style",
			fontFamily: "Komika Axis",
			bigFontFamily: "Komika Axis",
			smallFontFamily: "Komika Axis",
			fontSize: 76,
			fontWeight: 900,
			textColor: "#FFFFFF",
			activeWordColor: "#FFFF00",
			backgroundEnabled: false,
			backgroundOpacity: 0,
			lineHeight: 0.92,
			textTransform: "uppercase",
			textShadowEnabled: false,
			textStrokeEnabled: true,
			textStrokeColor: "#000000",
			textStrokeWidth: 7,
			textShadowColor: "#000000",
			textShadowOpacity: 0.3,
			textShadowBlur: 8,
			textShadowDistance: 4,
			textShadowAngle: 45,
			activeWordScale: 1.15,
			activeWordGlow: false,
			activeWordBackgroundEnabled: false,
			wordEffect: "pop",
			animationType: "pop",
			animationStrength: 1.35,
			animationSpeed: 1.4,
			animationSmoothness: 0,
			entranceAnimation: "pop",
			positionX: 50,
			positionY: 70,
			scale: 1,
			rotation: 0,
			opacity: 1,
			alignment: "center",
			maxWidth: 92,
			randomTiltEnabled: true,
			smartHighlightEnabled: true,
			emphasisGreenColor: "#00FF00",
			emphasisYellowColor: "#FFFF00",
			emphasisRedColor: "#FF0000",
		}),
		defaultChunkingConfig: chunkingConfig({
			targetWordsPerCaption: 2,
			maxWordsPerCaption: 2,
			minWordsPerCaption: 1,
			maxCharsPerCaption: 22,
			minCaptionDuration: 0.18,
			maxCaptionDuration: 1.2,
			pauseSplitThreshold: 0.3,
			mergeSmallGapThreshold: 0.04,
			targetReadingSpeedCps: 24,
			wordTimingSensitivity: 1,
			minWordDuration: 0.08,
			maxHoldAfterWord: 0,
			avoidSingleWordCaptions: false,
			balanceLineLength: false,
		}),
		supportedControls: [
			"font",
			"stroke",
			"shadow",
			"pop strength",
			"random tilt",
			"smart colors",
			"pause clear",
			"position",
		],
	},
	apple_cinematic: {
		id: "apple_cinematic",
		name: "Apple Cinematic",
		description:
			"Premium center-screen word reveals with opacity, upward motion, and blur.",
		previewText: "Apple Style",
		renderer: "apple_cinematic",
		defaultStyleConfig: normalizeCaptionStyleConfig({
			presetName: "Apple Cinematic",
			fontFamily: "Helvetica Local",
			bigFontFamily: "Helvetica Local",
			smallFontFamily: "Helvetica Local",
			fontSize: 68,
			fontWeight: 600,
			textColor: "#FFFFFF",
			activeWordColor: "#FFFFFF",
			backgroundEnabled: false,
			backgroundOpacity: 0,
			lineHeight: 1.05,
			letterSpacing: 0,
			textTransform: "none",
			textShadowEnabled: false,
			textStrokeEnabled: false,
			textShadowColor: "#000000",
			textShadowOpacity: 0.3,
			textShadowBlur: 8,
			textShadowDistance: 4,
			textShadowAngle: 45,
			activeWordScale: 1,
			activeWordBackgroundEnabled: false,
			wordEffect: "fade",
			animationType: "none",
			animationStrength: 0.4,
			animationSpeed: 1,
			animationSmoothness: 1,
			entranceAnimation: "fade",
			positionX: 50,
			positionY: 50,
			scale: 1,
			rotation: 0,
			opacity: 1,
			alignment: "center",
			maxWidth: 86,
			revealDuration: 0.32,
			revealYOffset: 30,
			revealBlur: 25,
			phraseHoldDuration: 0.2,
		}),
		defaultChunkingConfig: chunkingConfig({
			targetWordsPerCaption: 4,
			maxWordsPerCaption: 5,
			minWordsPerCaption: 2,
			maxCharsPerCaption: 34,
			minCaptionDuration: 0.8,
			maxCaptionDuration: 3.0,
			pauseSplitThreshold: 0.3,
			targetReadingSpeedCps: 17,
			wordTimingSensitivity: 1,
			minWordDuration: 0.08,
			maxHoldAfterWord: 0.12,
			avoidSingleWordCaptions: true,
			balanceLineLength: true,
		}),
		supportedControls: [
			"font",
			"weight",
			"tracking",
			"reveal duration",
			"blur",
			"position",
			"max width",
		],
	},
	modern_minimalist_lockup: {
		id: "modern_minimalist_lockup",
		name: "Editorial Lockup",
		description:
			"Editorial lockup captions with one anchor word and fixed reveal positions.",
		previewText: "change your life",
		renderer: "modern_minimalist_lockup",
		defaultStyleConfig: normalizeModernMinimalistStyleConfig(
			MODERN_MINIMALIST_BASE_CONFIG,
		),
		defaultChunkingConfig: chunkingConfig({
			targetWordsPerCaption: 3,
			maxWordsPerCaption: 4,
			minWordsPerCaption: 2,
			maxCharsPerCaption: 30,
			minCaptionDuration: 0.55,
			maxCaptionDuration: 2.2,
			pauseSplitThreshold: 0.3,
			targetReadingSpeedCps: 18,
			wordTimingSensitivity: 1,
			minWordDuration: 0.06,
			maxHoldAfterWord: 0.12,
			avoidSingleWordCaptions: true,
			balanceLineLength: true,
		}),
		supportedControls: [
			"font",
			"size",
			"weight",
			"tracking",
			"line height",
			"position",
			"scale",
			"stroke",
			"shadow",
			"background",
			"big word size",
			"small word size",
			"build layout",
			"tightness",
			"safe margin",
			"collision padding",
		],
	},
};

export const CAPTION_PRESET_LIST = Object.values(CAPTION_PRESET_REGISTRY);

export const CAPTION_STYLE_PRESETS: Record<
	CaptionStylePresetId,
	CaptionStyleConfig
> = Object.fromEntries(
	CAPTION_PRESET_LIST.map((preset) => [preset.id, preset.defaultStyleConfig]),
) as Record<CaptionStylePresetId, CaptionStyleConfig>;

export function getCaptionPreset(presetId: CaptionStylePresetId) {
	return (
		CAPTION_PRESET_REGISTRY[presetId] ||
		CAPTION_PRESET_REGISTRY.word_highlight_box
	);
}

export function getCaptionStylePreset(presetId: CaptionStylePresetId) {
	return getCaptionPreset(presetId).defaultStyleConfig;
}

export function getCaptionPresetChunkingConfig(presetId: CaptionStylePresetId) {
	return getCaptionPreset(presetId).defaultChunkingConfig;
}

export function isCaptionStylePresetId(
	value: string,
): value is CaptionStylePresetId {
	return value in CAPTION_PRESET_REGISTRY;
}
