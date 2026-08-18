/* eslint-disable opencut/prefer-object-params, @typescript-eslint/no-unsafe-type-assertion -- Runtime style sanitation narrows unknown persisted JSON values. */
import { getDefaultCapinstaCaptionStyle } from "./defaultStyle";
import { getCapinstaPresetStyle } from "./presetRegistry";
import type {
	CapinstaCaptionAlignment,
	CapinstaCaptionMaxLines,
	CapinstaCaptionPresetId,
	CapinstaCaptionLockupStyle,
	CapinstaCaptionStylePatch,
	CapinstaCaptionStyleV1,
	CapinstaOutlineWeight,
	CapinstaTransitionEffect,
	CapinstaWordEffect,
} from "./styleTypes";

const ALIGNMENTS = new Set<CapinstaCaptionAlignment>(["left", "center", "right"]);
const MAX_LINES = new Set<CapinstaCaptionMaxLines>(["auto", 1, 2, 3]);
const OUTLINES = new Set<CapinstaOutlineWeight>(["none", "thin", "medium", "thick"]);
const WORD_EFFECTS = new Set<CapinstaWordEffect>([
	"none",
	"highlight",
	"bounce",
	"paint",
	"pop",
	"fade",
	"reveal",
]);
const TRANSITIONS = new Set<CapinstaTransitionEffect>([
	"none",
	"fade",
	"flip",
	"pop",
	"slide",
]);
const LOCKUP_LAYOUT_MODES = new Set<CapinstaCaptionLockupStyle["layoutMode"]>([
	"auto",
	"center_anchor",
	"left_anchor",
	"right_anchor",
	"top_heavy",
	"bottom_stack",
	"split_lockup",
	"stacked",
	"inline",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.min(max, Math.max(min, value))
		: fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function stringValue(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function colorValue(value: unknown, fallback: string): string {
	if (typeof value !== "string") return fallback;
	if (/^#[0-9a-f]{3,8}$/i.test(value) || /^rgba?\(/i.test(value)) return value;
	return fallback;
}

function option<T extends string | number>(
	value: unknown,
	fallback: T,
	allowed: Set<T>,
): T {
	return allowed.has(value as T) ? (value as T) : fallback;
}

export function mergeCapinstaCaptionStyle(
	base: CapinstaCaptionStyleV1,
	patch: CapinstaCaptionStylePatch,
): CapinstaCaptionStyleV1 {
	return {
		...base,
		...patch,
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
	};
}

export function normalizeCapinstaCaptionStyle(
	input: unknown,
): CapinstaCaptionStyleV1 {
	const source = isRecord(input) ? input : {};
	const presetId = stringValue(source.presetId, "word_highlight_box") as CapinstaCaptionPresetId;
	const base = source.presetId ? getCapinstaPresetStyle(presetId) : getDefaultCapinstaCaptionStyle();
	const merged = mergeCapinstaCaptionStyle(base, source as CapinstaCaptionStylePatch);

	return {
		version: "capinsta.captionStyle.v1",
		presetId: merged.presetId,
		presetName: stringValue(merged.presetName, base.presetName),
		text: {
			fontFamily: stringValue(merged.text.fontFamily, base.text.fontFamily),
			fontWeight:
				merged.text.fontWeight === "normal" || merged.text.fontWeight === "bold"
					? merged.text.fontWeight
					: clamp(merged.text.fontWeight, 700, 100, 1000),
			alignment: option(merged.text.alignment, base.text.alignment, ALIGNMENTS),
			fontSize: clamp(merged.text.fontSize, base.text.fontSize, 8, 220),
			lineHeight: clamp(merged.text.lineHeight, base.text.lineHeight, 0.7, 2.5),
			maxLines: option(merged.text.maxLines, base.text.maxLines, MAX_LINES),
			color: colorValue(merged.text.color, base.text.color),
			opacity: clamp(merged.text.opacity, base.text.opacity, 0, 1),
			textTransform:
				merged.text.textTransform === "uppercase"
					? "uppercase"
					: merged.text.textTransform === "lowercase"
						? "lowercase"
						: merged.text.textTransform === "original"
							? "original"
							: "none",
			letterSpacing: clamp(merged.text.letterSpacing, base.text.letterSpacing, -2, 8),
		},
		background: {
			enabled: bool(merged.background.enabled, base.background.enabled),
			color: colorValue(merged.background.color, base.background.color),
			fit: merged.background.fit === "fill" ? "fill" : "wrap",
			opacity: clamp(merged.background.opacity, base.background.opacity, 0, 1),
			cornerRadius: clamp(merged.background.cornerRadius, base.background.cornerRadius, 0, 80),
			paddingX: clamp(merged.background.paddingX, base.background.paddingX, 0, 96),
			paddingY: clamp(merged.background.paddingY, base.background.paddingY, 0, 96),
			borderEnabled: bool(merged.background.borderEnabled, base.background.borderEnabled),
			borderColor: colorValue(merged.background.borderColor, base.background.borderColor),
			borderWidth: clamp(merged.background.borderWidth, base.background.borderWidth, 0, 16),
			shadowEnabled: bool(merged.background.shadowEnabled, base.background.shadowEnabled),
			shadowColor: colorValue(merged.background.shadowColor, base.background.shadowColor),
			shadowOpacity: clamp(merged.background.shadowOpacity, base.background.shadowOpacity, 0, 1),
			shadowBlur: clamp(merged.background.shadowBlur, base.background.shadowBlur, 0, 80),
			shadowDistance: clamp(merged.background.shadowDistance, base.background.shadowDistance, 0, 80),
			shadowAngle: clamp(merged.background.shadowAngle, base.background.shadowAngle, 0, 360),
		},
		outline: {
			weight: option(merged.outline.weight, base.outline.weight, OUTLINES),
			color: colorValue(merged.outline.color, base.outline.color),
			width: clamp(merged.outline.width, base.outline.width, 0, 16),
		},
		shadow: {
			enabled: bool(merged.shadow.enabled, base.shadow.enabled),
			color: colorValue(merged.shadow.color, base.shadow.color),
			opacity: clamp(merged.shadow.opacity, base.shadow.opacity, 0, 1),
			blur: clamp(merged.shadow.blur, base.shadow.blur, 0, 80),
			distance: clamp(merged.shadow.distance, base.shadow.distance, 0, 80),
			angle: clamp(merged.shadow.angle, base.shadow.angle, 0, 360),
		},
		activeWord: {
			color: colorValue(merged.activeWord.color, base.activeWord.color),
			backgroundEnabled: bool(merged.activeWord.backgroundEnabled, base.activeWord.backgroundEnabled),
			backgroundColor: colorValue(merged.activeWord.backgroundColor, base.activeWord.backgroundColor),
			backgroundOpacity: clamp(merged.activeWord.backgroundOpacity, base.activeWord.backgroundOpacity, 0, 1),
			backgroundPaddingX: clamp(merged.activeWord.backgroundPaddingX, base.activeWord.backgroundPaddingX, 0, 80),
			backgroundPaddingY: clamp(merged.activeWord.backgroundPaddingY, base.activeWord.backgroundPaddingY, 0, 80),
			backgroundCornerRadius: clamp(merged.activeWord.backgroundCornerRadius, base.activeWord.backgroundCornerRadius, 0, 80),
			scale: clamp(merged.activeWord.scale, base.activeWord.scale, 0.75, 1.8),
			glow: bool(merged.activeWord.glow, base.activeWord.glow),
		},
		animation: {
			wordEffect: option(merged.animation.wordEffect, base.animation.wordEffect, WORD_EFFECTS),
			type:
				merged.animation.type === "bounce" || merged.animation.type === "pop"
					? merged.animation.type
					: "none",
			transition: option(merged.animation.transition, base.animation.transition, TRANSITIONS),
			entrance: option(
				merged.animation.entrance ?? merged.animation.transition,
				base.animation.entrance,
				TRANSITIONS,
			),
			strength: clamp(merged.animation.strength, base.animation.strength, 0, 1.4),
			speed: clamp(merged.animation.speed, base.animation.speed, 0.4, 2),
			smoothness: clamp(merged.animation.smoothness, base.animation.smoothness, 0, 1),
		},
		layout: {
			positionX: clamp(merged.layout.positionX, base.layout.positionX, 0, 100),
			positionY: clamp(merged.layout.positionY, base.layout.positionY, 0, 100),
			maxWidth: clamp(merged.layout.maxWidth, base.layout.maxWidth, 20, 100),
			scale: clamp(merged.layout.scale, base.layout.scale, 0.25, 3),
			opacity: clamp(merged.layout.opacity, base.layout.opacity, 0, 1),
			rotation: clamp(merged.layout.rotation, base.layout.rotation, -180, 180),
			safeAreaEnabled: bool(merged.layout.safeAreaEnabled, base.layout.safeAreaEnabled),
			asymmetricScaleEnabled: bool(merged.layout.asymmetricScaleEnabled, base.layout.asymmetricScaleEnabled),
			asymmetricScaleStrength: clamp(
				merged.layout.asymmetricScaleStrength,
				base.layout.asymmetricScaleStrength,
				0,
				0.5,
			),
		},
		effects: {
			randomTiltEnabled: bool(merged.effects.randomTiltEnabled, base.effects.randomTiltEnabled),
			smartHighlightEnabled: bool(merged.effects.smartHighlightEnabled, base.effects.smartHighlightEnabled),
			emphasisGreenColor: colorValue(merged.effects.emphasisGreenColor, base.effects.emphasisGreenColor),
			emphasisYellowColor: colorValue(merged.effects.emphasisYellowColor, base.effects.emphasisYellowColor),
			emphasisRedColor: colorValue(merged.effects.emphasisRedColor, base.effects.emphasisRedColor),
		},
		reveal: {
			duration: clamp(merged.reveal.duration, base.reveal.duration, 0.05, 2),
			yOffset: clamp(merged.reveal.yOffset, base.reveal.yOffset, 0, 160),
			blur: clamp(merged.reveal.blur, base.reveal.blur, 0, 80),
			phraseHoldDuration: clamp(merged.reveal.phraseHoldDuration, base.reveal.phraseHoldDuration, 0, 2),
			hardCut: bool(merged.reveal.hardCut, base.reveal.hardCut),
		},
		lockup: {
			bigFontFamily: stringValue(merged.lockup.bigFontFamily, base.lockup.bigFontFamily),
			smallFontFamily: stringValue(merged.lockup.smallFontFamily, base.lockup.smallFontFamily),
			bigFontSizePx: clamp(merged.lockup.bigFontSizePx, base.lockup.bigFontSizePx, 24, 360),
			smallFontSizePx: clamp(merged.lockup.smallFontSizePx, base.lockup.smallFontSizePx, 12, 240),
			anchorSizeMultiplier: clamp(merged.lockup.anchorSizeMultiplier, base.lockup.anchorSizeMultiplier, 0.5, 4),
			supportSizeMultiplier: clamp(merged.lockup.supportSizeMultiplier, base.lockup.supportSizeMultiplier, 0.1, 2),
			layoutMode: option(merged.lockup.layoutMode, base.lockup.layoutMode, LOCKUP_LAYOUT_MODES),
			layoutAsymmetry: clamp(merged.lockup.layoutAsymmetry, base.lockup.layoutAsymmetry, 0, 1),
			layoutSafeMarginPercent: clamp(merged.lockup.layoutSafeMarginPercent, base.lockup.layoutSafeMarginPercent, 0, 30),
			collisionPadding: clamp(merged.lockup.collisionPadding, base.lockup.collisionPadding, 0, 80),
			tightness: clamp(merged.lockup.tightness, base.lockup.tightness, 0, 1),
			showBuildWordBounds: bool(merged.lockup.showBuildWordBounds, base.lockup.showBuildWordBounds),
		},
		chunking: {
			maxLines: option(merged.chunking.maxLines, base.chunking.maxLines, MAX_LINES),
			wordsPerCaption: clamp(merged.chunking.wordsPerCaption, base.chunking.wordsPerCaption ?? 3, 1, 20),
			charactersPerLine: clamp(merged.chunking.charactersPerLine, base.chunking.charactersPerLine ?? 34, 8, 80),
			removeFillerWords: bool(merged.chunking.removeFillerWords, Boolean(base.chunking.removeFillerWords)),
			targetWordsPerCaption: clamp(merged.chunking.targetWordsPerCaption, base.chunking.targetWordsPerCaption ?? 3, 1, 20),
			maxWordsPerCaption: clamp(merged.chunking.maxWordsPerCaption, base.chunking.maxWordsPerCaption ?? 4, 1, 20),
			minWordsPerCaption: clamp(merged.chunking.minWordsPerCaption, base.chunking.minWordsPerCaption ?? 1, 1, 20),
			maxCharsPerCaption: clamp(merged.chunking.maxCharsPerCaption, base.chunking.maxCharsPerCaption ?? 34, 8, 120),
			minCaptionDuration: clamp(merged.chunking.minCaptionDuration, base.chunking.minCaptionDuration ?? 0.35, 0.05, 10),
			maxCaptionDuration: clamp(merged.chunking.maxCaptionDuration, base.chunking.maxCaptionDuration ?? 2.2, 0.05, 20),
			pauseSplitThreshold: clamp(merged.chunking.pauseSplitThreshold, base.chunking.pauseSplitThreshold ?? 0.45, 0, 5),
			mergeSmallGapThreshold: clamp(merged.chunking.mergeSmallGapThreshold, base.chunking.mergeSmallGapThreshold ?? 0.04, 0, 2),
			targetReadingSpeedCps: clamp(merged.chunking.targetReadingSpeedCps, base.chunking.targetReadingSpeedCps ?? 18, 1, 80),
			wordTimingSensitivity: clamp(merged.chunking.wordTimingSensitivity, base.chunking.wordTimingSensitivity ?? 1, 0, 5),
			minWordDuration: clamp(merged.chunking.minWordDuration, base.chunking.minWordDuration ?? 0.08, 0.01, 5),
			maxHoldAfterWord: clamp(merged.chunking.maxHoldAfterWord, base.chunking.maxHoldAfterWord ?? 0.12, 0, 5),
			avoidSingleWordCaptions: bool(merged.chunking.avoidSingleWordCaptions, Boolean(base.chunking.avoidSingleWordCaptions)),
			balanceLineLength: bool(merged.chunking.balanceLineLength, Boolean(base.chunking.balanceLineLength)),
		},
	};
}
