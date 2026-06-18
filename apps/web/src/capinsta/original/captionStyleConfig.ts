/* eslint-disable opencut/prefer-object-params -- Transplanted original Capinsta style normalization is kept structurally faithful for visual parity. */
import { CaptionStyleConfig } from "./types";

export const CREATOR_FONTS = [
  "Komika Axis",
  "CCSignLanguage",
  "Obelix Pro",
  "Poppins",
  "Inter",
  "SF Pro Display",
  "Helvetica",
  "Helvetica Neue",
  "Montserrat",
  "LostaMasta",
  "Made Avenue",
  "Tactic",
  "8-BIT WONDER",
  "BlackChancery",
  "Brushstrike",
  "Deltha",
  "Roboto",
  "Oswald",
  "Anton",
  "Bebas Neue",
  "Impact",
  "Arial Black",
  "Georgia",
  "Arial",
] as const;

export const FONT_STACKS: Record<string, string> = {
  "Komika Axis": "'Komika Axis', 'CCSignLanguage', 'Obelix Pro', 'Anton', Impact, 'Arial Black', sans-serif",
  CCSignLanguage: "'CCSignLanguage', 'Komika Axis', 'Anton', Impact, 'Arial Black', sans-serif",
  "Obelix Pro": "'Obelix Pro', 'Komika Axis', 'Anton', Impact, 'Arial Black', sans-serif",
  Poppins: "'Poppins', 'Inter', Arial, sans-serif",
  Inter: "'Inter', Arial, sans-serif",
  "SF Pro Display": "'SF Pro Display', 'Inter', 'Helvetica Neue', Arial, sans-serif",
  Helvetica: "'Helvetica Local', 'Helvetica Neue', Helvetica, Inter, Arial, sans-serif",
  "Helvetica Neue": "'Helvetica Neue', Inter, Arial, sans-serif",
  Montserrat: "'Montserrat Local', 'Montserrat', 'Inter', Arial, sans-serif",
  LostaMasta: "'LostaMasta', 'Poppins', Impact, sans-serif",
  "Made Avenue": "'Made Avenue', 'Georgia', serif",
  Tactic: "'Tactic', 'Inter', Arial, sans-serif",
  "8-BIT WONDER": "'8-BIT WONDER', Impact, sans-serif",
  BlackChancery: "'BlackChancery', Georgia, serif",
  Brushstrike: "'Brushstrike', Impact, sans-serif",
  Deltha: "'Deltha', Impact, sans-serif",
  Roboto: "'Roboto', Arial, sans-serif",
  Oswald: "'Oswald', 'Arial Narrow', Arial, sans-serif",
  Anton: "'Anton', Impact, Arial, sans-serif",
  "Bebas Neue": "'Bebas Neue', 'Arial Narrow', Arial, sans-serif",
  Impact: "Impact, 'Arial Black', sans-serif",
  "Arial Black": "'Arial Black', Impact, sans-serif",
  Georgia: "Georgia, 'Times New Roman', serif",
  Arial: "Arial, sans-serif",
};

export const BUILD_BIG_FONT_SIZE_PX = 220;
export const BUILD_SMALL_FONT_SIZE_PX = 104;

export const DEFAULT_WORD_HIGHLIGHT_BOX_CONFIG: CaptionStyleConfig = {
  presetName: "Word Highlight Box",
  fontFamily: "Poppins",
  bigFontFamily: "Poppins",
  smallFontFamily: "Poppins",
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
  letterSpacing: 0,
  lineHeight: 1.12,
  textTransform: "none",
  textShadowEnabled: false,
  textStrokeEnabled: false,
  textStrokeColor: "#000000",
  textStrokeWidth: 0,
  textShadowColor: "#000000",
  textShadowOpacity: 0.3,
  textShadowBlur: 8,
  textShadowDistance: 4,
  textShadowAngle: 45,
  activeWordScale: 1.06,
  activeWordGlow: false,
  activeWordBackgroundEnabled: false,
  activeWordBackgroundColor: "#000000",
  activeWordBackgroundOpacity: 0.35,
  activeWordBackgroundPaddingX: 6,
  activeWordBackgroundPaddingY: 2,
  activeWordBackgroundBorderRadius: 8,
  wordEffect: "pop",
  animationType: "pop",
  animationStrength: 0.55,
  animationSpeed: 1,
  animationSmoothness: 0.72,
  entranceAnimation: "none",
  backgroundShadow: false,
  backgroundBorderEnabled: false,
  backgroundBorderColor: "#FFFFFF",
  backgroundBorderWidth: 0,
  backgroundShadowColor: "#000000",
  backgroundShadowOpacity: 0.3,
  backgroundShadowBlur: 8,
  backgroundShadowDistance: 4,
  backgroundShadowAngle: 45,
  safeAreaEnabled: true,
  positionX: 50,
  positionY: 78,
  scale: 1,
  rotation: 0,
  opacity: 1,
  alignment: "center",
  maxWidth: 82,
  maxLines: 2,
  asymmetricScaleEnabled: false,
  asymmetricScaleStrength: 0,
  randomTiltEnabled: false,
  smartHighlightEnabled: false,
  emphasisGreenColor: "#00FF00",
  emphasisYellowColor: "#FFFF00",
  emphasisRedColor: "#FF0000",
  revealDuration: 0.28,
  revealYOffset: 30,
  revealBlur: 25,
  phraseHoldDuration: 0.2,
  bigFontSizePx: BUILD_BIG_FONT_SIZE_PX,
  smallFontSizePx: BUILD_SMALL_FONT_SIZE_PX,
  anchorSizeMultiplier: 1.55,
  supportSizeMultiplier: 0.28,
  layoutMode: "auto",
  layoutAsymmetry: 0.45,
  layoutSafeMarginPercent: 8,
  collisionPadding: 8,
  showBuildWordBounds: false,
  tightness: 0.75,
  hardCutReveal: false,
};

export const MODERN_MINIMALIST_BASE_CONFIG: CaptionStyleConfig = {
  ...DEFAULT_WORD_HIGHLIGHT_BOX_CONFIG,
  presetName: "Editorial Lockup",
  fontFamily: "Inter",
  bigFontFamily: "Inter",
  smallFontFamily: "Inter",
  fontSize: 112,
  fontWeight: 900,
  textColor: "#FFFFFF",
  activeWordColor: "#FFFFFF",
  backgroundEnabled: false,
  backgroundOpacity: 0,
  backgroundShadow: false,
  backgroundBorderEnabled: false,
  lineHeight: 0.95,
  textTransform: "none",
  textShadowEnabled: false,
  textStrokeEnabled: false,
  textShadowColor: "#000000",
  textShadowOpacity: 0.3,
  textShadowBlur: 8,
  textShadowDistance: 4,
  textShadowAngle: 45,
  activeWordScale: 1,
  wordEffect: "reveal",
  animationType: "none",
  animationStrength: 0,
  animationSpeed: 1,
  animationSmoothness: 0,
  entranceAnimation: "slide",
  safeAreaEnabled: true,
  positionX: 50,
  positionY: 50,
  scale: 1,
  rotation: 0,
  opacity: 1,
  alignment: "center",
  maxWidth: 86,
  maxLines: 2,
  asymmetricScaleEnabled: false,
  asymmetricScaleStrength: 0,
  bigFontSizePx: BUILD_BIG_FONT_SIZE_PX,
  smallFontSizePx: BUILD_SMALL_FONT_SIZE_PX,
  anchorSizeMultiplier: 1.55,
  supportSizeMultiplier: 0.28,
  layoutMode: "auto",
  layoutAsymmetry: 0.45,
  layoutSafeMarginPercent: 8,
  collisionPadding: 8,
  showBuildWordBounds: false,
  tightness: 0.75,
  hardCutReveal: false,
};

const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function safeColor(value: unknown, fallback: string) {
  return typeof value === "string" && HEX_COLOR_RE.test(value) ? value.toUpperCase() : fallback;
}

function safeFont(value: unknown) {
  return typeof value === "string" && value in FONT_STACKS ? value : DEFAULT_WORD_HIGHLIGHT_BOX_CONFIG.fontFamily;
}

function safeLayoutMode(value: unknown): CaptionStyleConfig["layoutMode"] {
  if (value === "a") return "center_anchor";
  if (value === "b") return "left_anchor";
  if (value === "c") return "right_anchor";
  if (
    value === "auto" ||
    value === "center_anchor" ||
    value === "left_anchor" ||
    value === "right_anchor" ||
    value === "top_heavy" ||
    value === "bottom_stack" ||
    value === "split_lockup"
  ) {
    return value;
  }
  return DEFAULT_WORD_HIGHLIGHT_BOX_CONFIG.layoutMode;
}

function safeBackgroundFit(value: unknown) {
  return value === "fill" ? "fill" : "wrap";
}

function safeMaxLines(value: unknown) {
  return value === "auto" || value === 1 || value === 2 || value === 3 ? value : DEFAULT_WORD_HIGHLIGHT_BOX_CONFIG.maxLines;
}

function safeWordEffect(value: unknown) {
  return value === "none" ||
    value === "reveal" ||
    value === "highlight" ||
    value === "bounce" ||
    value === "paint" ||
    value === "pop" ||
    value === "fade"
    ? value
    : DEFAULT_WORD_HIGHLIGHT_BOX_CONFIG.wordEffect;
}

export function resolveFontFamily(fontFamily: string) {
  return FONT_STACKS[fontFamily] || FONT_STACKS[DEFAULT_WORD_HIGHLIGHT_BOX_CONFIG.fontFamily];
}

function safeEntranceAnimation(value: unknown): CaptionStyleConfig["entranceAnimation"] {
  if (value === "slide_up") return "slide";
  if (value === "blur_fade") return "flip";
  if (value === "hard_cut") return "none";
  return value === "none" || value === "fade" || value === "flip" || value === "pop" || value === "slide"
    ? value
    : DEFAULT_WORD_HIGHLIGHT_BOX_CONFIG.entranceAnimation;
}

export function backgroundRgba(config: CaptionStyleConfig) {
  const hex = safeColor(config.backgroundColor, DEFAULT_WORD_HIGHLIGHT_BOX_CONFIG.backgroundColor).replace("#", "");
  const fullHex = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  const r = parseInt(fullHex.slice(0, 2), 16);
  const g = parseInt(fullHex.slice(2, 4), 16);
  const b = parseInt(fullHex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp(config.backgroundOpacity, 0, 1, 0.78)})`;
}

export function colorToRgba(color: string, opacity: number) {
  const hex = safeColor(color, "#000000").replace("#", "");
  const fullHex = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  const r = parseInt(fullHex.slice(0, 2), 16);
  const g = parseInt(fullHex.slice(2, 4), 16);
  const b = parseInt(fullHex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp(opacity, 0, 1, 1)})`;
}

export function directionalShadow(
  color: string,
  opacity: number,
  distance: number,
  blur: number,
  angle: number
) {
  if (opacity <= 0 || (distance <= 0 && blur <= 0)) return "";
  const radians = (angle * Math.PI) / 180;
  const x = Math.cos(radians) * distance;
  const y = Math.sin(radians) * distance;
  return `${x.toFixed(1)}px ${y.toFixed(1)}px ${Math.max(0, blur)}px ${colorToRgba(color, opacity)}`;
}

export function normalizeCaptionStyleConfig(
  raw?: Partial<CaptionStyleConfig> | null
): CaptionStyleConfig {
  const defaults = DEFAULT_WORD_HIGHLIGHT_BOX_CONFIG;
  const merged = { ...defaults, ...(raw || {}) };
  const inferredWordEffect = raw?.wordEffect || (merged.activeWordBackgroundEnabled ? "highlight" : defaults.wordEffect);
  const wordEffect = safeWordEffect(inferredWordEffect);
  const activeWordColor = safeColor(merged.activeWordColor, defaults.activeWordColor);
  const activeWordBackgroundColor = safeColor(
    wordEffect === "highlight" && !raw?.activeWordBackgroundColor ? activeWordColor : merged.activeWordBackgroundColor,
    defaults.activeWordBackgroundColor
  );
  const bigFontSizePx = clamp(merged.bigFontSizePx, 80, 400, defaults.bigFontSizePx || BUILD_BIG_FONT_SIZE_PX);
  const smallFontSizePx = Math.min(
    bigFontSizePx,
    clamp(merged.smallFontSizePx, 20, 160, defaults.smallFontSizePx || BUILD_SMALL_FONT_SIZE_PX)
  );

  return {
    presetName: typeof merged.presetName === "string" && merged.presetName.trim() ? merged.presetName : defaults.presetName,
    fontFamily: safeFont(merged.fontFamily),
    bigFontFamily: safeFont(merged.bigFontFamily || merged.fontFamily),
    smallFontFamily: safeFont(merged.smallFontFamily || merged.fontFamily),
    fontSize: clamp(merged.fontSize, 0, 180, defaults.fontSize),
    fontWeight: Math.round(clamp(merged.fontWeight, 100, 1000, Number(defaults.fontWeight) || 900) / 50) * 50,
    textColor: safeColor(merged.textColor, defaults.textColor),
    activeWordColor,
    backgroundEnabled: Boolean(merged.backgroundEnabled),
    backgroundColor: safeColor(merged.backgroundColor, defaults.backgroundColor),
    backgroundOpacity: clamp(merged.backgroundOpacity, 0, 1, defaults.backgroundOpacity),
    backgroundFit: safeBackgroundFit(merged.backgroundFit),
    borderRadius: clamp(merged.borderRadius, 0, 36, defaults.borderRadius),
    paddingX: clamp(merged.paddingX, 6, 48, defaults.paddingX),
    paddingY: clamp(merged.paddingY, 4, 32, defaults.paddingY),
    letterSpacing: clamp(merged.letterSpacing, -2, 8, defaults.letterSpacing),
    lineHeight: clamp(merged.lineHeight, 0.9, 1.6, defaults.lineHeight),
    textTransform: merged.textTransform === "uppercase" ? "uppercase" : "none",
    textShadowEnabled: Boolean(merged.textShadowEnabled),
    textStrokeEnabled: Boolean(merged.textStrokeEnabled),
    textStrokeColor: safeColor(merged.textStrokeColor, defaults.textStrokeColor),
    textStrokeWidth: clamp(merged.textStrokeWidth, 0, 8, defaults.textStrokeWidth),
    textShadowColor: safeColor(merged.textShadowColor, defaults.textShadowColor),
    textShadowOpacity: clamp(merged.textShadowOpacity, 0, 1, defaults.textShadowOpacity),
    textShadowBlur: clamp(merged.textShadowBlur, 0, 24, defaults.textShadowBlur),
    textShadowDistance: clamp(merged.textShadowDistance, 0, 24, defaults.textShadowDistance),
    textShadowAngle: clamp(merged.textShadowAngle, 0, 360, defaults.textShadowAngle),
    activeWordScale: clamp(merged.activeWordScale, 1, 1.16, defaults.activeWordScale),
    activeWordGlow: Boolean(merged.activeWordGlow),
    activeWordBackgroundEnabled: Boolean(merged.activeWordBackgroundEnabled),
    activeWordBackgroundColor,
    activeWordBackgroundOpacity: clamp(merged.activeWordBackgroundOpacity, 0, 1, defaults.activeWordBackgroundOpacity),
    activeWordBackgroundPaddingX: clamp(merged.activeWordBackgroundPaddingX, 0, 28, defaults.activeWordBackgroundPaddingX),
    activeWordBackgroundPaddingY: clamp(merged.activeWordBackgroundPaddingY, 0, 18, defaults.activeWordBackgroundPaddingY),
    activeWordBackgroundBorderRadius: clamp(merged.activeWordBackgroundBorderRadius, 0, 28, defaults.activeWordBackgroundBorderRadius),
    wordEffect,
    animationType: merged.animationType === "bounce" || merged.animationType === "none" ? merged.animationType : "pop",
    animationStrength: clamp(merged.animationStrength, 0, 1.4, defaults.animationStrength),
    animationSpeed: clamp(merged.animationSpeed, 0.4, 2, defaults.animationSpeed),
    animationSmoothness: clamp(merged.animationSmoothness, 0, 1, defaults.animationSmoothness),
    entranceAnimation: safeEntranceAnimation(merged.entranceAnimation),
    backgroundShadow: Boolean(merged.backgroundShadow),
    backgroundBorderEnabled: Boolean(merged.backgroundBorderEnabled),
    backgroundBorderColor: safeColor(merged.backgroundBorderColor, defaults.backgroundBorderColor),
    backgroundBorderWidth: clamp(merged.backgroundBorderWidth, 0, 8, defaults.backgroundBorderWidth),
    backgroundShadowColor: safeColor(merged.backgroundShadowColor, defaults.backgroundShadowColor),
    backgroundShadowOpacity: clamp(merged.backgroundShadowOpacity, 0, 1, defaults.backgroundShadowOpacity),
    backgroundShadowBlur: clamp(merged.backgroundShadowBlur, 0, 60, defaults.backgroundShadowBlur),
    backgroundShadowDistance: clamp(merged.backgroundShadowDistance, 0, 36, defaults.backgroundShadowDistance),
    backgroundShadowAngle: clamp(merged.backgroundShadowAngle, 0, 360, defaults.backgroundShadowAngle),
    safeAreaEnabled: Boolean(merged.safeAreaEnabled),
    positionX: clamp(merged.positionX, 0, 100, defaults.positionX),
    positionY: clamp(merged.positionY, 0, 100, defaults.positionY),
    scale: clamp(merged.scale, 0, 4, defaults.scale),
    rotation: clamp(merged.rotation, -180, 180, defaults.rotation),
    opacity: clamp(merged.opacity, 0, 1, defaults.opacity),
    alignment:
      merged.alignment === "left" || merged.alignment === "right" || merged.alignment === "center"
        ? merged.alignment
        : defaults.alignment,
    maxWidth: clamp(merged.maxWidth, 20, 96, defaults.maxWidth),
    maxLines: safeMaxLines(merged.maxLines),
    asymmetricScaleEnabled: Boolean(merged.asymmetricScaleEnabled),
    asymmetricScaleStrength: clamp(merged.asymmetricScaleStrength, 0, 1, defaults.asymmetricScaleStrength || 0),
    randomTiltEnabled: Boolean(merged.randomTiltEnabled),
    smartHighlightEnabled: Boolean(merged.smartHighlightEnabled),
    emphasisGreenColor: safeColor(merged.emphasisGreenColor, defaults.emphasisGreenColor || "#00FF00"),
    emphasisYellowColor: safeColor(merged.emphasisYellowColor, defaults.emphasisYellowColor || "#FFFF00"),
    emphasisRedColor: safeColor(merged.emphasisRedColor, defaults.emphasisRedColor || "#FF0000"),
    revealDuration: clamp(merged.revealDuration, 0.08, 0.9, defaults.revealDuration || 0.28),
    revealYOffset: clamp(merged.revealYOffset, 0, 80, defaults.revealYOffset || 30),
    revealBlur: clamp(merged.revealBlur, 0, 40, defaults.revealBlur || 25),
    phraseHoldDuration: clamp(merged.phraseHoldDuration, 0, 2, defaults.phraseHoldDuration || 0.2),
    bigFontSizePx,
    smallFontSizePx,
    anchorSizeMultiplier: clamp(merged.anchorSizeMultiplier, 0.8, 2, defaults.anchorSizeMultiplier || 1.55),
    supportSizeMultiplier: clamp(merged.supportSizeMultiplier, 0.18, 0.6, defaults.supportSizeMultiplier || 0.28),
    layoutMode: safeLayoutMode(merged.layoutMode),
    layoutAsymmetry: clamp(merged.layoutAsymmetry, 0, 1, defaults.layoutAsymmetry || 0.45),
    layoutSafeMarginPercent: clamp(merged.layoutSafeMarginPercent, 0, 20, defaults.layoutSafeMarginPercent || 8),
    collisionPadding: clamp(merged.collisionPadding, 0, 120, defaults.collisionPadding || 8),
    showBuildWordBounds: Boolean(merged.showBuildWordBounds),
    tightness: clamp(merged.tightness, 0, 10, defaults.tightness || 0.75),
    hardCutReveal: merged.hardCutReveal !== false,
  };
}

export function normalizeModernMinimalistStyleConfig(
  raw?: Partial<CaptionStyleConfig> | null
): CaptionStyleConfig {
  const presetName = typeof raw?.presetName === "string" ? raw.presetName.toLowerCase() : "";
  const isBuildConfig =
    presetName.includes("modern minimalist") ||
    presetName.includes("editorial") ||
    presetName.includes("build") ||
    raw?.layoutMode !== undefined ||
    raw?.bigFontSizePx !== undefined ||
    raw?.smallFontSizePx !== undefined ||
    raw?.anchorSizeMultiplier !== undefined ||
    raw?.supportSizeMultiplier !== undefined ||
    raw?.layoutAsymmetry !== undefined;
  const normalized = normalizeCaptionStyleConfig({
    ...MODERN_MINIMALIST_BASE_CONFIG,
    ...(isBuildConfig ? raw : {}),
    presetName: MODERN_MINIMALIST_BASE_CONFIG.presetName,
  });

  return {
    ...normalized,
    backgroundShadow: normalized.backgroundEnabled && normalized.backgroundShadow,
    backgroundBorderEnabled: normalized.backgroundEnabled && normalized.backgroundBorderEnabled,
  };
}
