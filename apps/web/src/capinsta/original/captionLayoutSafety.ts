/* eslint-disable opencut/prefer-object-params -- Transplanted original Capinsta layout safety logic is kept structurally faithful for visual parity. */
import type { CSSProperties } from "react";
import type { AlignedWord, CaptionLayoutSafetyConfig, CaptionStyleConfig } from "./types";
import { getWordDisplayText } from "./captionUtils";

export const DEFAULT_CAPTION_LAYOUT_SAFETY_CONFIG: CaptionLayoutSafetyConfig = {
  maxWidthPercent: 82,
  maxHeightPercent: 28,
  safeMarginPercent: 8,
  defaultFontSize: 54,
  minFontSize: 0,
  maxFontSize: 180,
  defaultScale: 1,
  minScale: 0,
  maxScale: 4,
  lineClamp: 2,
  wrapMode: "balanced",
};

export interface CaptionCanvasSize {
  width: number;
  height: number;
}

export interface SafeCaptionLayout {
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  maxHeightPercent: number;
  safeMarginPercent: number;
  groupScale: number;
  fontSize: number;
  lineClamp: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeCanvas(canvas?: Partial<CaptionCanvasSize> | null): CaptionCanvasSize {
  return {
    width: Math.max(1, Number(canvas?.width) || 1080),
    height: Math.max(1, Number(canvas?.height) || 1920),
  };
}

function normalizedTokens(words?: AlignedWord[], text?: string) {
  const wordTokens = words?.map(getWordDisplayText).filter(Boolean) || [];
  if (wordTokens.length) return wordTokens;
  return (text || "").split(/\s+/).map((token) => token.trim()).filter(Boolean);
}

function responsiveFontSize(config: CaptionStyleConfig, canvas: CaptionCanvasSize, safety: CaptionLayoutSafetyConfig) {
  const rawFontSize = Number.isFinite(config.fontSize) && config.fontSize > 0 ? config.fontSize : safety.defaultFontSize;
  const referenceHeight = canvas.height >= canvas.width ? 1920 : 1080;
  const responsive = rawFontSize * (canvas.height / referenceHeight);
  return clamp(responsive, safety.minFontSize, safety.maxFontSize);
}

export function resolveSafeCaptionLayout(
  config: CaptionStyleConfig,
  options: {
    canvas?: Partial<CaptionCanvasSize> | null;
    previewScale?: number;
    words?: AlignedWord[];
    text?: string;
    safety?: CaptionLayoutSafetyConfig;
  } = {}
): SafeCaptionLayout {
  const safety = options.safety || DEFAULT_CAPTION_LAYOUT_SAFETY_CONFIG;
  const canvas = normalizeCanvas(options.canvas);
  const previewScale = clamp(Number(options.previewScale) || 1, 0.01, 8);
  const tokens = normalizedTokens(options.words, options.text);
  const text = tokens.join(" ");
  const longestWordLength = Math.max(1, ...tokens.map((token) => token.length));
  const charCount = Math.max(1, text.length);

  const safeMarginPercent = config.safeAreaEnabled ? safety.safeMarginPercent : 0;
  const groupScale = clamp(
    Number.isFinite(config.scale) ? config.scale : safety.defaultScale,
    safety.minScale,
    safety.maxScale
  );
  const visualWidthPercent = clamp(
    Math.min(config.maxWidth || safety.maxWidthPercent, safety.maxWidthPercent),
    Math.min(45, safety.maxWidthPercent),
    100 - safeMarginPercent * 2
  );
  const widthPercent = clamp(
    visualWidthPercent / Math.max(1, groupScale),
    18,
    visualWidthPercent
  );
  const visualMaxHeightPercent = clamp(safety.maxHeightPercent, 8, 100 - safeMarginPercent * 2);
  const maxHeightPercent = clamp(
    visualMaxHeightPercent / Math.max(1, groupScale),
    6,
    visualMaxHeightPercent
  );

  const availableWidth = (canvas.width * widthPercent) / 100;
  const availableHeight = (canvas.height * maxHeightPercent) / 100;
  const lineClamp = config.maxLines === "auto" ? Math.max(1, Math.round(safety.lineClamp)) : config.maxLines;
  const lineHeight = clamp(Number(config.lineHeight) || 1.1, 0.9, 1.6);
  const charWidthFactor = config.textTransform === "uppercase" || Number(config.fontWeight) >= 800 ? 0.62 : 0.56;

  const baseFont = responsiveFontSize(config, canvas, safety);
  const longestWordFit = availableWidth / (longestWordLength * charWidthFactor);
  const balancedTextFit = (availableWidth * lineClamp * 0.78) / (charCount * charWidthFactor);
  const heightFit = availableHeight / (lineClamp * lineHeight);
  const designFontSize = clamp(
    Math.min(baseFont, longestWordFit, balancedTextFit || baseFont, heightFit || baseFont),
    safety.minFontSize,
    safety.maxFontSize
  );

  const halfWidth = (widthPercent * groupScale) / 2;
  const halfHeight = (maxHeightPercent * groupScale) / 2;
  const minX = safeMarginPercent + halfWidth;
  const maxX = 100 - safeMarginPercent - halfWidth;
  const minY = safeMarginPercent + halfHeight;
  const maxY = 100 - safeMarginPercent - halfHeight;

  return {
    xPercent: clamp(config.positionX, minX, maxX),
    yPercent: clamp(config.positionY, minY, maxY),
    widthPercent,
    maxHeightPercent,
    safeMarginPercent,
    groupScale,
    fontSize: Math.max(0, Math.round(designFontSize * previewScale)),
    lineClamp,
  };
}

export function buildSafeCaptionPositionStyle(
  config: CaptionStyleConfig,
  layout: SafeCaptionLayout,
  transformPrefix = "translate(-50%, -50%)"
): CSSProperties {
  return {
    position: "absolute",
    left: `${layout.xPercent}%`,
    top: `${layout.yPercent}%`,
    width: `${layout.widthPercent}%`,
    maxHeight: `${layout.maxHeightPercent}%`,
    display: "flex",
    justifyContent: config.alignment === "left" ? "flex-start" : config.alignment === "right" ? "flex-end" : "center",
    pointerEvents: "none",
    opacity: config.opacity,
    transform: `${transformPrefix} scale(${layout.groupScale}) rotate(${config.rotation}deg)`,
    transformOrigin: "50% 50%",
  };
}

export const SAFE_CAPTION_TEXT_STYLE: CSSProperties = {
  whiteSpace: "normal",
  wordBreak: "normal",
  overflowWrap: "normal",
  hyphens: "none",
};
