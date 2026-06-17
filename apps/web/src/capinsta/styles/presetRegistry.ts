import { getDefaultCapinstaCaptionStyle } from "./defaultStyle";
import type {
	CapinstaCaptionPresetId,
	CapinstaCaptionStyleV1,
	CapinstaCaptionStylePatch,
	CapinstaOutlineWeight,
} from "./styleTypes";

export interface CapinstaPresetDefinition {
	id: CapinstaCaptionPresetId;
	name: string;
	description: string;
	style: CapinstaCaptionStyleV1;
}

const ORIGINAL_DEFAULT_CHUNKING: CapinstaCaptionStylePatch["chunking"] = {
	maxLines: 2,
	wordsPerCaption: 3,
	charactersPerLine: 34,
	targetWordsPerCaption: 3,
	maxWordsPerCaption: 4,
	minWordsPerCaption: 1,
	maxCharsPerCaption: 34,
	minCaptionDuration: 0.35,
	maxCaptionDuration: 2.2,
	pauseSplitThreshold: 0.45,
	mergeSmallGapThreshold: 0.04,
	targetReadingSpeedCps: 18,
	wordTimingSensitivity: 1,
	minWordDuration: 0.08,
	maxHoldAfterWord: 0.12,
	avoidSingleWordCaptions: true,
	balanceLineLength: true,
};

function originalChunking(
	overrides: CapinstaCaptionStylePatch["chunking"] = {},
): CapinstaCaptionStylePatch["chunking"] {
	return { ...ORIGINAL_DEFAULT_CHUNKING, ...overrides };
}

function makePreset({
	id,
	name,
	description,
	patch,
}: {
	id: CapinstaCaptionPresetId;
	name: string;
	description: string;
	patch: CapinstaCaptionStylePatch;
}): CapinstaPresetDefinition {
	const base = getDefaultCapinstaCaptionStyle();
	return {
		id,
		name,
		description,
		style: {
			...base,
			...patch,
			presetId: id,
			presetName: name,
			text: { ...base.text, ...patch.text },
			background: { ...base.background, ...patch.background },
			outline: { ...base.outline, ...patch.outline },
			shadow: { ...base.shadow, ...patch.shadow },
			activeWord: { ...base.activeWord, ...patch.activeWord },
			animation: { ...base.animation, ...patch.animation },
			layout: { ...base.layout, ...patch.layout },
			effects: { ...base.effects, ...patch.effects },
			reveal: { ...base.reveal, ...patch.reveal },
			lockup: { ...base.lockup, ...patch.lockup },
			chunking: { ...base.chunking, ...patch.chunking },
		},
	};
}

interface CapinstaSourceStyleConfig {
	fontFamily: string;
	bigFontFamily?: string;
	smallFontFamily?: string;
	fontSize: number;
	fontWeight: number;
	textColor: string;
	activeWordColor: string;
	backgroundEnabled: boolean;
	backgroundColor: string;
	backgroundOpacity: number;
	backgroundFit?: "wrap" | "fill";
	borderRadius?: number;
	paddingX?: number;
	paddingY?: number;
	letterSpacing?: number;
	lineHeight: number;
	textTransform?: "none" | "uppercase";
	textShadowEnabled?: boolean;
	textShadowColor?: string;
	textShadowOpacity?: number;
	textShadowBlur?: number;
	textShadowDistance?: number;
	textShadowAngle?: number;
	textStrokeEnabled?: boolean;
	textStrokeColor?: string;
	textStrokeWidth?: number;
	activeWordScale: number;
	activeWordGlow?: boolean;
	activeWordBackgroundEnabled?: boolean;
	activeWordBackgroundColor?: string;
	activeWordBackgroundOpacity?: number;
	activeWordBackgroundPaddingX?: number;
	activeWordBackgroundPaddingY?: number;
	activeWordBackgroundBorderRadius?: number;
	wordEffect: CapinstaCaptionStyleV1["animation"]["wordEffect"];
	animationType: CapinstaCaptionStyleV1["animation"]["type"];
	animationStrength: number;
	animationSpeed: number;
	animationSmoothness: number;
	entranceAnimation: CapinstaCaptionStyleV1["animation"]["entrance"];
	backgroundShadow?: boolean;
	backgroundBorderEnabled?: boolean;
	backgroundBorderColor?: string;
	backgroundBorderWidth?: number;
	backgroundShadowColor?: string;
	backgroundShadowOpacity?: number;
	backgroundShadowBlur?: number;
	backgroundShadowDistance?: number;
	backgroundShadowAngle?: number;
	safeAreaEnabled?: boolean;
	positionX: number;
	positionY: number;
	scale?: number;
	rotation?: number;
	opacity?: number;
	alignment?: CapinstaCaptionStyleV1["text"]["alignment"];
	maxWidth: number;
	maxLines?: CapinstaCaptionStyleV1["text"]["maxLines"];
	asymmetricScaleEnabled?: boolean;
	asymmetricScaleStrength?: number;
	randomTiltEnabled?: boolean;
	smartHighlightEnabled?: boolean;
	emphasisGreenColor?: string;
	emphasisYellowColor?: string;
	emphasisRedColor?: string;
	revealDuration?: number;
	revealYOffset?: number;
	revealBlur?: number;
	phraseHoldDuration?: number;
	bigFontSizePx?: number;
	smallFontSizePx?: number;
	anchorSizeMultiplier?: number;
	supportSizeMultiplier?: number;
	layoutMode?: CapinstaCaptionStyleV1["lockup"]["layoutMode"];
	layoutAsymmetry?: number;
	layoutSafeMarginPercent?: number;
	collisionPadding?: number;
	showBuildWordBounds?: boolean;
	tightness?: number;
	hardCutReveal?: boolean;
}

function outlineWeight(width: number): CapinstaOutlineWeight {
	if (width <= 0) return "none";
	if (width <= 2) return "thin";
	if (width <= 5) return "medium";
	return "thick";
}

function sourcePresetPatch({
	source,
	chunking,
}: {
	source: CapinstaSourceStyleConfig;
	chunking?: CapinstaCaptionStylePatch["chunking"];
}): CapinstaCaptionStylePatch {
	const strokeWidth =
		source.textStrokeEnabled === false ? 0 : (source.textStrokeWidth ?? 0);
	return {
		text: {
			fontFamily: source.fontFamily,
			fontSize: source.fontSize,
			fontWeight: source.fontWeight,
			lineHeight: source.lineHeight,
			maxLines: source.maxLines ?? 2,
			color: source.textColor,
			opacity: source.opacity ?? 1,
			textTransform: source.textTransform ?? "none",
			letterSpacing: source.letterSpacing ?? 0,
			alignment: source.alignment ?? "center",
		},
		background: {
			enabled: source.backgroundEnabled,
			color: source.backgroundColor,
			fit: source.backgroundFit ?? "wrap",
			opacity: source.backgroundOpacity,
			cornerRadius: source.borderRadius ?? 8,
			paddingX: source.paddingX ?? 14,
			paddingY: source.paddingY ?? 8,
			borderEnabled: Boolean(source.backgroundBorderEnabled),
			borderColor: source.backgroundBorderColor ?? "#ffffff",
			borderWidth: source.backgroundBorderWidth ?? 0,
			shadowEnabled: Boolean(source.backgroundShadow),
			shadowColor: source.backgroundShadowColor ?? "#000000",
			shadowOpacity: source.backgroundShadowOpacity ?? 0.3,
			shadowBlur: source.backgroundShadowBlur ?? 8,
			shadowDistance: source.backgroundShadowDistance ?? 4,
			shadowAngle: source.backgroundShadowAngle ?? 45,
		},
		outline: {
			weight: outlineWeight(strokeWidth),
			color: source.textStrokeColor ?? "#000000",
			width: strokeWidth,
		},
		shadow: {
			enabled: Boolean(source.textShadowEnabled),
			color: source.textShadowColor ?? "#000000",
			opacity: source.textShadowOpacity ?? 0.3,
			blur: source.textShadowBlur ?? 8,
			distance: source.textShadowDistance ?? 4,
			angle: source.textShadowAngle ?? 45,
		},
		activeWord: {
			color: source.activeWordColor,
			backgroundEnabled: Boolean(source.activeWordBackgroundEnabled),
			backgroundColor:
				source.activeWordBackgroundColor ?? source.activeWordColor,
			backgroundOpacity: source.activeWordBackgroundOpacity ?? 0.35,
			backgroundPaddingX: source.activeWordBackgroundPaddingX ?? 6,
			backgroundPaddingY: source.activeWordBackgroundPaddingY ?? 2,
			backgroundCornerRadius:
				source.activeWordBackgroundBorderRadius ?? 8,
			scale: source.activeWordScale,
			glow: Boolean(source.activeWordGlow),
		},
		animation: {
			wordEffect: source.wordEffect,
			type: source.animationType,
			transition: source.entranceAnimation,
			entrance: source.entranceAnimation,
			strength: source.animationStrength,
			speed: source.animationSpeed,
			smoothness: source.animationSmoothness,
		},
		layout: {
			positionX: source.positionX,
			positionY: source.positionY,
			maxWidth: source.maxWidth,
			scale: source.scale ?? 1,
			opacity: source.opacity ?? 1,
			rotation: source.rotation ?? 0,
			safeAreaEnabled: source.safeAreaEnabled ?? true,
			asymmetricScaleEnabled: Boolean(source.asymmetricScaleEnabled),
			asymmetricScaleStrength: source.asymmetricScaleStrength ?? 0,
		},
		effects: {
			randomTiltEnabled: Boolean(source.randomTiltEnabled),
			smartHighlightEnabled: Boolean(source.smartHighlightEnabled),
			emphasisGreenColor: source.emphasisGreenColor ?? "#00FF00",
			emphasisYellowColor: source.emphasisYellowColor ?? "#FFFF00",
			emphasisRedColor: source.emphasisRedColor ?? "#FF0000",
		},
		reveal: {
			duration: source.revealDuration ?? 0.28,
			yOffset: source.revealYOffset ?? 30,
			blur: source.revealBlur ?? 25,
			phraseHoldDuration: source.phraseHoldDuration ?? 0.2,
			hardCut: Boolean(source.hardCutReveal),
		},
		lockup: {
			bigFontFamily: source.bigFontFamily ?? source.fontFamily,
			smallFontFamily: source.smallFontFamily ?? source.fontFamily,
			bigFontSizePx: source.bigFontSizePx ?? 220,
			smallFontSizePx: source.smallFontSizePx ?? 104,
			anchorSizeMultiplier: source.anchorSizeMultiplier ?? 1.55,
			supportSizeMultiplier: source.supportSizeMultiplier ?? 0.28,
			layoutMode: source.layoutMode ?? "auto",
			layoutAsymmetry: source.layoutAsymmetry ?? 0.45,
			layoutSafeMarginPercent: source.layoutSafeMarginPercent ?? 8,
			collisionPadding: source.collisionPadding ?? 8,
			tightness: source.tightness ?? 0.75,
			showBuildWordBounds: Boolean(source.showBuildWordBounds),
		},
		chunking,
	};
}

export const CAPINSTA_CAPTION_PRESETS: CapinstaPresetDefinition[] = [
	makePreset({
		id: "word_highlight_box",
		name: "Word Highlight Box",
		description: "Clean creator captions with active-word highlighting.",
		patch: sourcePresetPatch({
			source: {
				fontFamily: "Poppins",
				fontSize: 54,
				fontWeight: 900,
				textColor: "#FFFFFF",
				activeWordColor: "#FFD43B",
				backgroundEnabled: true,
				backgroundColor: "#000000",
				backgroundOpacity: 1,
				backgroundFit: "wrap",
				borderRadius: 16,
				paddingX: 24,
				paddingY: 14,
				lineHeight: 1.12,
				textShadowEnabled: false,
				textStrokeEnabled: false,
				activeWordScale: 1.06,
				activeWordGlow: false,
				activeWordBackgroundEnabled: false,
				wordEffect: "pop",
				animationType: "pop",
				animationStrength: 0.55,
				animationSpeed: 1,
				animationSmoothness: 0.72,
				entranceAnimation: "none",
				backgroundShadow: false,
				positionX: 50,
				positionY: 78,
				maxWidth: 82,
				maxLines: 2,
			},
			chunking: originalChunking(),
		}),
	}),
	makePreset({ id: "attention_punch", name: "Attention Punch", description: "Bold outlined words with punchy active-word emphasis.", patch: {
		...sourcePresetPatch({
			source: {
				fontFamily: "Anton",
				bigFontFamily: "Anton",
				smallFontFamily: "Anton",
				fontSize: 64,
				fontWeight: 900,
				textColor: "#FFFFFF",
				activeWordColor: "#FFD43B",
				backgroundEnabled: false,
				backgroundColor: "#000000",
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
				maxWidth: 90,
			},
		}),
	} }),
	makePreset({ id: "apple_cinematic", name: "Apple Cinematic", description: "Premium center-screen word reveals with opacity, upward motion, and blur.", patch: {
		...sourcePresetPatch({
			source: {
				fontFamily: "SF Pro Display",
				bigFontFamily: "SF Pro Display",
				smallFontFamily: "SF Pro Display",
				fontSize: 68,
				fontWeight: 600,
				textColor: "#FFFFFF",
				activeWordColor: "#FFFFFF",
				backgroundEnabled: false,
				backgroundColor: "#000000",
				backgroundOpacity: 0,
				lineHeight: 1.05,
				letterSpacing: 0,
				textShadowEnabled: false,
				textStrokeEnabled: false,
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
				maxWidth: 86,
				revealDuration: 0.32,
				revealYOffset: 30,
				revealBlur: 25,
				phraseHoldDuration: 0.2,
			},
			chunking: originalChunking({
				wordsPerCaption: 4,
				targetWordsPerCaption: 4,
				maxWordsPerCaption: 5,
				minWordsPerCaption: 2,
				maxCharsPerCaption: 34,
				minCaptionDuration: 0.8,
				maxCaptionDuration: 3,
				pauseSplitThreshold: 0.45,
				targetReadingSpeedCps: 17,
				wordTimingSensitivity: 1,
				minWordDuration: 0.08,
				maxHoldAfterWord: 0.12,
				avoidSingleWordCaptions: true,
				balanceLineLength: true,
			}),
		}),
	} }),
	makePreset({ id: "kinetic_fade", name: "Kinetic Fade", description: "Smooth word reveal with lightweight motion.", patch: {
		...sourcePresetPatch({
			source: {
				fontFamily: "Poppins",
				bigFontFamily: "Poppins",
				smallFontFamily: "Poppins",
				fontSize: 56,
				fontWeight: 800,
				textColor: "#FFFFFF",
				activeWordColor: "#BDE0FF",
				backgroundEnabled: false,
				backgroundColor: "#000000",
				backgroundOpacity: 0,
				borderRadius: 8,
				paddingX: 14,
				paddingY: 8,
				lineHeight: 1.08,
				textShadowEnabled: false,
				textStrokeEnabled: false,
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
				maxWidth: 88,
			},
		}),
	} }),
	makePreset({ id: "mrbeast_style", name: "MrBeast Style", description: "1-2 word all-caps captions with heavy stroke, smart colors, and mechanical pop.", patch: {
		...sourcePresetPatch({
			source: {
				fontFamily: "Komika Axis",
				bigFontFamily: "Komika Axis",
				smallFontFamily: "Komika Axis",
				fontSize: 76,
				fontWeight: 900,
				textColor: "#FFFFFF",
				activeWordColor: "#FFFF00",
				backgroundEnabled: false,
				backgroundColor: "#000000",
				backgroundOpacity: 0,
				lineHeight: 0.92,
				textTransform: "uppercase",
				textShadowEnabled: false,
				textStrokeEnabled: true,
				textStrokeColor: "#000000",
				textStrokeWidth: 7,
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
				maxWidth: 92,
				randomTiltEnabled: true,
				smartHighlightEnabled: true,
				emphasisGreenColor: "#00FF00",
				emphasisYellowColor: "#FFFF00",
				emphasisRedColor: "#FF0000",
			},
			chunking: originalChunking({
				wordsPerCaption: 2,
				charactersPerLine: 22,
				targetWordsPerCaption: 2,
				maxWordsPerCaption: 2,
				minWordsPerCaption: 1,
				maxCharsPerCaption: 22,
				minCaptionDuration: 0.18,
				maxCaptionDuration: 1.2,
				pauseSplitThreshold: 0.5,
				mergeSmallGapThreshold: 0.04,
				targetReadingSpeedCps: 24,
				wordTimingSensitivity: 1,
				minWordDuration: 0.08,
				maxHoldAfterWord: 0,
				avoidSingleWordCaptions: false,
				balanceLineLength: false,
			}),
		}),
	} }),
	makePreset({ id: "modern_minimalist_lockup", name: "Editorial Lockup", description: "Editorial lockup captions with one anchor word and fixed reveal positions.", patch: {
		...sourcePresetPatch({
			source: {
				fontFamily: "Inter",
				bigFontFamily: "Inter",
				smallFontFamily: "Inter",
				fontSize: 112,
				fontWeight: 900,
				textColor: "#FFFFFF",
				activeWordColor: "#FFFFFF",
				backgroundEnabled: false,
				backgroundColor: "#000000",
				backgroundOpacity: 0,
				backgroundShadow: false,
				backgroundBorderEnabled: false,
				lineHeight: 0.95,
				textShadowEnabled: false,
				textStrokeEnabled: false,
				activeWordScale: 1,
				activeWordGlow: false,
				wordEffect: "reveal",
				animationType: "none",
				animationStrength: 0,
				animationSpeed: 1,
				animationSmoothness: 0,
				entranceAnimation: "slide",
				positionX: 50,
				positionY: 50,
				maxWidth: 86,
				maxLines: 2,
				bigFontSizePx: 220,
				smallFontSizePx: 104,
				anchorSizeMultiplier: 1.55,
				supportSizeMultiplier: 0.28,
				layoutMode: "auto",
				layoutAsymmetry: 0.45,
				layoutSafeMarginPercent: 8,
				collisionPadding: 8,
				showBuildWordBounds: false,
				tightness: 0.75,
				hardCutReveal: false,
			},
			chunking: originalChunking({
				wordsPerCaption: 3,
				charactersPerLine: 30,
				targetWordsPerCaption: 3,
				maxWordsPerCaption: 4,
				minWordsPerCaption: 2,
				maxCharsPerCaption: 30,
				minCaptionDuration: 0.55,
				maxCaptionDuration: 2.2,
				pauseSplitThreshold: 0.45,
				targetReadingSpeedCps: 18,
				wordTimingSensitivity: 1,
				minWordDuration: 0.06,
				maxHoldAfterWord: 0.12,
				avoidSingleWordCaptions: true,
				balanceLineLength: true,
			}),
		}),
	} }),
];

export const CAPINSTA_PRESET_IDS = CAPINSTA_CAPTION_PRESETS.map((preset) => preset.id);

export function getCapinstaPreset(
	id: string | undefined,
): CapinstaPresetDefinition {
	return (
		CAPINSTA_CAPTION_PRESETS.find((preset) => preset.id === id) ??
		CAPINSTA_CAPTION_PRESETS[0]
	);
}

export function getCapinstaPresetStyle(id: string | undefined): CapinstaCaptionStyleV1 {
	return structuredClone(getCapinstaPreset(id).style);
}
