export type CapinstaCaptionStyleVersion = "capinsta.captionStyle.v1";

export type CapinstaCaptionPresetId =
	| "word_highlight_box"
	| "attention_punch"
	| "apple_cinematic"
	| "kinetic_fade"
	| "mrbeast_style"
	| "modern_minimalist_lockup"
	| "dynamic_punch";

export type CapinstaCaptionAlignment = "left" | "center" | "right";
export type CapinstaCaptionMaxLines = "auto" | 1 | 2 | 3;
export type CapinstaWordEffect =
	| "none"
	| "highlight"
	| "bounce"
	| "paint"
	| "pop"
	| "fade"
	| "reveal";
export type CapinstaTransitionEffect = "none" | "fade" | "flip" | "pop" | "slide";
export type CapinstaBackgroundFit = "wrap" | "fill";
export type CapinstaOutlineWeight = "none" | "thin" | "medium" | "thick";

export interface CapinstaCaptionTextStyle {
	fontFamily: string;
	fontWeight: "normal" | "bold" | number;
	alignment: CapinstaCaptionAlignment;
	fontSize: number;
	lineHeight: number;
	maxLines: CapinstaCaptionMaxLines;
	color: string;
	opacity: number;
	textTransform: "none" | "original" | "uppercase" | "lowercase";
	letterSpacing: number;
	wordSpacing: number;
}

export interface CapinstaCaptionBackgroundStyle {
	enabled: boolean;
	color: string;
	fit: CapinstaBackgroundFit;
	opacity: number;
	cornerRadius: number;
	paddingX: number;
	paddingY: number;
	borderEnabled: boolean;
	borderColor: string;
	borderWidth: number;
	shadowEnabled: boolean;
	shadowColor: string;
	shadowOpacity: number;
	shadowBlur: number;
	shadowDistance: number;
	shadowAngle: number;
}

export interface CapinstaCaptionOutlineStyle {
	weight: CapinstaOutlineWeight;
	color: string;
	width: number;
}

export interface CapinstaCaptionShadowStyle {
	enabled: boolean;
	color: string;
	opacity: number;
	blur: number;
	distance: number;
	angle: number;
	intensity: number;
}

export interface CapinstaCaptionActiveWordStyle {
	color: string;
	backgroundEnabled: boolean;
	backgroundColor: string;
	backgroundOpacity: number;
	backgroundPaddingX: number;
	backgroundPaddingY: number;
	backgroundCornerRadius: number;
	scale: number;
	glow: boolean;
}

export interface CapinstaCaptionAnimationStyle {
	wordEffect: CapinstaWordEffect;
	type: "none" | "pop" | "bounce";
	transition: CapinstaTransitionEffect;
	entrance: CapinstaTransitionEffect;
	strength: number;
	speed: number;
	smoothness: number;
}

export interface CapinstaCaptionLayoutStyle {
	positionX: number;
	positionY: number;
	maxWidth: number;
	scale: number;
	opacity: number;
	rotation: number;
	safeAreaEnabled: boolean;
	asymmetricScaleEnabled: boolean;
	asymmetricScaleStrength: number;
}

export interface CapinstaCaptionFidelityEffects {
	randomTiltEnabled: boolean;
	smartHighlightEnabled: boolean;
	emphasisGreenColor: string;
	emphasisYellowColor: string;
	emphasisRedColor: string;
}

export interface CapinstaCaptionRevealStyle {
	duration: number;
	yOffset: number;
	blur: number;
	phraseHoldDuration: number;
	hardCut: boolean;
}

export interface CapinstaCaptionLockupStyle {
	bigFontFamily: string;
	smallFontFamily: string;
	bigFontSizePx: number;
	smallFontSizePx: number;
	anchorSizeMultiplier: number;
	supportSizeMultiplier: number;
	layoutMode:
		| "auto"
		| "center_anchor"
		| "left_anchor"
		| "right_anchor"
		| "top_heavy"
		| "bottom_stack"
		| "split_lockup"
		| "stacked"
		| "inline";
	layoutAsymmetry: number;
	layoutSafeMarginPercent: number;
	collisionPadding: number;
	tightness: number;
	showBuildWordBounds: boolean;
}

export interface CapinstaCaptionChunkingStyle {
	maxLines: CapinstaCaptionMaxLines;
	wordsPerCaption?: number;
	charactersPerLine?: number;
	removeFillerWords?: boolean;
	targetWordsPerCaption?: number;
	maxWordsPerCaption?: number;
	minWordsPerCaption?: number;
	maxCharsPerCaption?: number;
	minCaptionDuration?: number;
	maxCaptionDuration?: number;
	pauseSplitThreshold?: number;
	mergeSmallGapThreshold?: number;
	targetReadingSpeedCps?: number;
	wordTimingSensitivity?: number;
	minWordDuration?: number;
	maxHoldAfterWord?: number;
	avoidSingleWordCaptions?: boolean;
	balanceLineLength?: boolean;
}

export interface CapinstaCaptionStyleV1 {
	version: CapinstaCaptionStyleVersion;
	presetId: CapinstaCaptionPresetId;
	presetName: string;
	text: CapinstaCaptionTextStyle;
	background: CapinstaCaptionBackgroundStyle;
	outline: CapinstaCaptionOutlineStyle;
	shadow: CapinstaCaptionShadowStyle;
	activeWord: CapinstaCaptionActiveWordStyle;
	animation: CapinstaCaptionAnimationStyle;
	layout: CapinstaCaptionLayoutStyle;
	effects: CapinstaCaptionFidelityEffects;
	reveal: CapinstaCaptionRevealStyle;
	lockup: CapinstaCaptionLockupStyle;
	chunking: CapinstaCaptionChunkingStyle;
}

export type DeepPartial<T> = {
	[K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export type CapinstaCaptionStylePatch = DeepPartial<CapinstaCaptionStyleV1>;
