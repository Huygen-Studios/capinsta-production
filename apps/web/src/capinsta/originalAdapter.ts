import type {
	NeutralCaptionClip,
	NeutralCaptionDocument,
	NeutralCaptionWord,
} from "./types";
import type { Caption, CaptionStyleConfig } from "./original/types";
import type { CapinstaCaptionStyleV1 } from "./styles/styleTypes";
import { resolveCapinstaClipStyle } from "./styles/styleMigration";

function toOriginalWord(word: NeutralCaptionWord) {
	return {
		word: word.text,
		displayedWord: word.displayedText || word.text,
		originalWord: word.originalText || word.text,
		spokenWord: word.spokenText,
		start: word.start,
		end: word.end,
		score: word.score ?? word.confidence ?? 0,
		confidence: word.confidence,
		provider: word.provider,
		timingSource: word.timingSource,
		timing_source: word.timingSourceDetail ?? word.timingSource,
		languageHint: word.languageHint,
		timingNeedsReview: word.timingNeedsReview,
		timing_repair: word.timingRepair,
	};
}

export function toOriginalCaptionStyleConfig({
	style,
}: {
	style: CapinstaCaptionStyleV1;
}): CaptionStyleConfig {
	return {
		presetName: style.presetName,
		fontFamily: style.text.fontFamily,
		bigFontFamily: style.lockup.bigFontFamily || style.text.fontFamily,
		smallFontFamily: style.lockup.smallFontFamily || style.text.fontFamily,
		fontSize: style.text.fontSize,
		fontWeight: style.text.fontWeight,
		textColor: style.text.color,
		activeWordColor: style.activeWord.color,
		backgroundEnabled: style.background.enabled,
		backgroundColor: style.background.color,
		backgroundOpacity: style.background.opacity,
		backgroundFit: style.background.fit,
		borderRadius: style.background.cornerRadius,
		paddingX: style.background.paddingX,
		paddingY: style.background.paddingY,
		letterSpacing: style.text.letterSpacing,
		lineHeight: style.text.lineHeight,
		textTransform:
			style.text.textTransform === "uppercase"
				? "uppercase"
				: style.text.textTransform === "lowercase"
					? "lowercase"
					: "none",
		textShadowEnabled: style.shadow.enabled,
		textStrokeEnabled: style.outline.width > 0,
		textStrokeColor: style.outline.color,
		textStrokeWidth: style.outline.width,
		textShadowColor: style.shadow.color,
		textShadowOpacity: style.shadow.opacity,
		textShadowBlur: style.shadow.blur,
		textShadowDistance: style.shadow.distance,
		textShadowAngle: style.shadow.angle,
		activeWordScale: style.activeWord.scale,
		activeWordGlow: style.activeWord.glow,
		activeWordBackgroundEnabled: style.activeWord.backgroundEnabled,
		activeWordBackgroundColor: style.activeWord.backgroundColor,
		activeWordBackgroundOpacity: style.activeWord.backgroundOpacity,
		activeWordBackgroundPaddingX: style.activeWord.backgroundPaddingX,
		activeWordBackgroundPaddingY: style.activeWord.backgroundPaddingY,
		activeWordBackgroundBorderRadius: style.activeWord.backgroundCornerRadius,
		wordEffect: style.animation.wordEffect,
		animationType: style.animation.type,
		animationStrength: style.animation.strength,
		animationSpeed: style.animation.speed,
		animationSmoothness: style.animation.smoothness,
		entranceAnimation: style.animation.entrance,
		backgroundShadow: style.background.shadowEnabled,
		backgroundBorderEnabled: style.background.borderEnabled,
		backgroundBorderColor: style.background.borderColor,
		backgroundBorderWidth: style.background.borderWidth,
		backgroundShadowColor: style.background.shadowColor,
		backgroundShadowOpacity: style.background.shadowOpacity,
		backgroundShadowBlur: style.background.shadowBlur,
		backgroundShadowDistance: style.background.shadowDistance,
		backgroundShadowAngle: style.background.shadowAngle,
		safeAreaEnabled: style.layout.safeAreaEnabled,
		positionX: style.layout.positionX,
		positionY: style.layout.positionY,
		scale: style.layout.scale,
		rotation: style.layout.rotation,
		opacity: style.layout.opacity,
		alignment: style.text.alignment,
		maxWidth: style.layout.maxWidth,
		maxLines: style.text.maxLines,
		asymmetricScaleEnabled: style.layout.asymmetricScaleEnabled,
		asymmetricScaleStrength: style.layout.asymmetricScaleStrength,
		randomTiltEnabled: style.effects.randomTiltEnabled,
		smartHighlightEnabled: style.effects.smartHighlightEnabled,
		emphasisGreenColor: style.effects.emphasisGreenColor,
		emphasisYellowColor: style.effects.emphasisYellowColor,
		emphasisRedColor: style.effects.emphasisRedColor,
		revealDuration: style.reveal.duration,
		revealYOffset: style.reveal.yOffset,
		revealBlur: style.reveal.blur,
		phraseHoldDuration: style.reveal.phraseHoldDuration,
		bigFontSizePx: style.lockup.bigFontSizePx,
		smallFontSizePx: style.lockup.smallFontSizePx,
		anchorSizeMultiplier: style.lockup.anchorSizeMultiplier,
		supportSizeMultiplier: style.lockup.supportSizeMultiplier,
		layoutMode: normalizeOriginalLayoutMode(style.lockup.layoutMode),
		layoutAsymmetry: style.lockup.layoutAsymmetry,
		layoutSafeMarginPercent: style.lockup.layoutSafeMarginPercent,
		collisionPadding: style.lockup.collisionPadding,
		showBuildWordBounds: style.lockup.showBuildWordBounds,
		tightness: style.lockup.tightness,
		hardCutReveal: style.reveal.hardCut,
	};
}

export function toOriginalCaption({
	document,
	clip,
	style,
}: {
	document: NeutralCaptionDocument;
	clip: NeutralCaptionClip;
	style?: CapinstaCaptionStyleV1;
}): Caption {
	const wordsById = new Map(document.words.map((word) => [word.id, word]));
	const words = clip.wordIds
		.map((wordId) => wordsById.get(wordId))
		.filter((word): word is NeutralCaptionWord => word !== undefined)
		.map(toOriginalWord);
	const resolvedStyle =
		style ?? resolveCapinstaClipStyle({ document, clip });

	return {
		id: clip.id,
		trackId: clip.trackId,
		start: clip.start,
		end: clip.end,
		text: clip.text,
		originalText: clip.manualEdit?.originalText || clip.text,
		lang: document.languageMode,
		theme: resolvedStyle.presetId,
		words,
		manuallyEdited: clip.manuallyEdited,
		timingNeedsReview: clip.timingNeedsReview,
	};
}

function normalizeOriginalLayoutMode(
	mode: CapinstaCaptionStyleV1["lockup"]["layoutMode"],
): CaptionStyleConfig["layoutMode"] {
	if (mode === "stacked") return "center_anchor";
	if (mode === "inline") return "split_lockup";
	return mode;
}
