"use client";

import React from "react";
import { Caption, CaptionStyle, CaptionStyleConfig, CAPTION_THEMES } from "@/lib/types";
import {
  CaptionCanvasSize,
  SAFE_CAPTION_TEXT_STYLE,
  SafeCaptionLayout,
  buildSafeCaptionPositionStyle,
  resolveSafeCaptionLayout,
} from "@/lib/captionLayoutSafety";
import {
  BUILD_BIG_FONT_SIZE_PX,
  BUILD_SMALL_FONT_SIZE_PX,
  backgroundRgba,
  directionalShadow,
  normalizeCaptionStyleConfig,
  normalizeModernMinimalistStyleConfig,
  resolveFontFamily,
} from "@/lib/captionStyleConfig";
import { getCaptionDisplayText, getRenderableCaptionWords, getWordDisplayText } from "@/lib/captionUtils";
import ViralWordHighlightCaption from "./ViralWordHighlightCaption";
import WordHighlightBoxCaption from "./WordHighlightBoxCaption";

interface Props {
  captions: Caption[];
  currentTime: number;
  fps?: number;
  scale?: number;
  transition?: boolean;
  styleConfig?: Partial<CaptionStyleConfig> | null;
  canvasSize?: CaptionCanvasSize;
}

type TimedCaptionWord = {
  word: string;
  displayedWord?: string;
  originalWord?: string;
  start: number;
  end: number;
  score: number;
};

const HIGHLIGHT_COLORS: Record<string, string> = {
  word_highlight_box: "#FFD43B",
  viral_word_highlight: "#22f4b8",
  viral_shorts: "#FFD700",
  kalakar_fire: "#ff6b35",
  karaoke_neon: "#00ff88",
  neon_glow: "#00ffff",
  gradient_wave: "#ff6ec7",
  comic_pop: "#FFD700",
};

function buildPositionStyle(themeStyle: CaptionStyle): React.CSSProperties {
  const positionStyle: React.CSSProperties = {};
  if (themeStyle.position === "bottom") {
    positionStyle.bottom = "8%";
  } else if (themeStyle.position === "top") {
    positionStyle.top = "8%";
  } else {
    positionStyle.top = "50%";
    positionStyle.transform = "translateY(-50%)";
  }
  return positionStyle;
}

function buildTextShadow(themeStyle: CaptionStyle): string | undefined {
  const parts: string[] = [];
  if (themeStyle.outline && themeStyle.outlineColor) {
    const c = themeStyle.outlineColor;
    parts.push(
      `2px 2px 0 ${c}`,
      `-2px -2px 0 ${c}`,
      `2px -2px 0 ${c}`,
      `-2px 2px 0 ${c}`,
      `1px 1px 0 ${c}`,
      `-1px -1px 0 ${c}`,
      `1px -1px 0 ${c}`,
      `-1px 1px 0 ${c}`
    );
  }
  if (themeStyle.shadow && themeStyle.shadow !== "none") {
    parts.push(themeStyle.shadow);
  }
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function buildConfigTextShadow(config: CaptionStyleConfig) {
  if (!config.textShadowEnabled) return undefined;
  const shadow = directionalShadow(
    config.textShadowColor,
    config.textShadowOpacity,
    config.textShadowDistance,
    config.textShadowBlur,
    config.textShadowAngle
  );
  return shadow || undefined;
}

function justifyFromAlignment(alignment: CaptionStyleConfig["alignment"]) {
  return alignment === "left" ? "flex-start" : alignment === "right" ? "flex-end" : "center";
}

function buildConfigPositionStyle(config: CaptionStyleConfig, layout?: SafeCaptionLayout): React.CSSProperties {
  return buildSafeCaptionPositionStyle(config, layout || resolveSafeCaptionLayout(config));
}

function buildCaptionSurfaceStyle(config: CaptionStyleConfig, scale: number): React.CSSProperties {
  return {
    maxWidth: "100%",
    width: config.backgroundFit === "fill" ? "100%" : undefined,
    padding: config.backgroundEnabled
      ? `${Math.max(0, config.paddingY * scale)}px ${Math.max(0, config.paddingX * scale)}px`
      : 0,
    borderRadius: config.backgroundEnabled ? Math.max(0, config.borderRadius * scale) : 0,
    background: config.backgroundEnabled ? backgroundRgba(config) : "transparent",
    border: config.backgroundBorderEnabled
      ? `${Math.max(0, config.backgroundBorderWidth * scale)}px solid ${config.backgroundBorderColor}`
      : "none",
    boxShadow: config.backgroundEnabled && config.backgroundShadow
      ? directionalShadow(
          config.backgroundShadowColor,
          config.backgroundShadowOpacity,
          config.backgroundShadowDistance * scale,
          config.backgroundShadowBlur * scale,
          config.backgroundShadowAngle
        )
      : undefined,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundTime(value: number) {
  return Math.round(value * 1000) / 1000;
}

function interpolate(input: number, inMin: number, inMax: number, outMin: number, outMax: number) {
  const t = clamp((input - inMin) / Math.max(0.0001, inMax - inMin), 0, 1);
  return outMin + (outMax - outMin) * t;
}

function easeOutExpo(t: number) {
  const safe = clamp(t, 0, 1);
  return safe === 1 ? 1 : 1 - Math.pow(2, -10 * safe);
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function combineTransforms(...parts: string[]) {
  return parts.filter(Boolean).join(" ").trim() || "translateY(0) scale(1)";
}

function asymmetricScaleTransform(config: CaptionStyleConfig, progress: number) {
  if (!config.asymmetricScaleEnabled || !config.asymmetricScaleStrength) return "";
  const strength = clamp(config.asymmetricScaleStrength, 0, 1);
  const squash = Math.sin(clamp(progress, 0, 1) * Math.PI);
  const x = 1 + strength * squash * 0.08;
  const y = 1 - strength * squash * 0.045;
  return `scaleX(${x.toFixed(3)}) scaleY(${y.toFixed(3)})`;
}

function wordMotionTransform(ageFrames: number, config: CaptionStyleConfig, isAnchor = false) {
  if (config.animationType === "none" || config.animationStrength <= 0 || ageFrames < 0) {
    return "translateY(0) scale(1)";
  }

  const speed = Math.max(0.4, config.animationSpeed) * (isAnchor ? 0.9 : 1);
  const smoothness = clamp(config.animationSmoothness, 0, 1);
  const peakFrame = Math.max(2, (3 + smoothness * 2) / speed);
  const settleFrame = Math.max(peakFrame + 2, (8 + smoothness * 4) / speed);
  const maxScale = 1 + (config.activeWordScale - 1) * config.animationStrength;
  const lift = (config.animationType === "bounce" ? -4 : -2.5) * config.animationStrength;

  if (ageFrames <= peakFrame) {
    const startScale = interpolate(config.animationStrength, 0, 1.4, 1, 0.98);
    const scale = interpolate(ageFrames, 0, peakFrame, startScale, maxScale);
    const y = interpolate(ageFrames, 0, peakFrame, 5 * config.animationStrength, lift);
    return combineTransforms(`translateY(${y}px) scale(${scale})`, asymmetricScaleTransform(config, ageFrames / peakFrame));
  }

  if (ageFrames <= settleFrame) {
    const settle = config.animationType === "bounce" && ageFrames < settleFrame - 2 ? 0.98 : 1;
    const scale = interpolate(ageFrames, peakFrame, settleFrame, maxScale, settle);
    const y = interpolate(ageFrames, peakFrame, settleFrame, lift, 0);
    return combineTransforms(`translateY(${y}px) scale(${scale})`, asymmetricScaleTransform(config, 1 - (ageFrames - peakFrame) / Math.max(0.001, settleFrame - peakFrame)));
  }

  return "translateY(0) scale(1)";
}

function wordEntranceStyle(wordStart: number, currentTime: number, fps: number, config: CaptionStyleConfig): React.CSSProperties {
  if (currentTime < wordStart) return { opacity: 0, transform: "translateY(0) scale(1)" };
  if (config.entranceAnimation === "none" || config.entranceAnimation === "hard_cut") {
    return { opacity: 1, transform: "translateY(0) scale(1)", filter: "none" };
  }

  const ageFrames = Math.max(0, (currentTime - wordStart) * fps);
  const duration = Math.max(2, Math.round(8 / Math.max(0.4, config.animationSpeed)));
  const progress = easeOutExpo(ageFrames / duration);

  if (config.entranceAnimation === "fade") {
    return { opacity: progress, transform: "translateY(0) scale(1)", filter: "none" };
  }
  if (config.entranceAnimation === "pop") {
    const scale = progress < 0.72
      ? interpolate(progress, 0, 0.72, 0.85, 1.05)
      : interpolate(progress, 0.72, 1, 1.05, 1);
    return { opacity: progress, transform: combineTransforms(`translateY(0) scale(${scale})`, asymmetricScaleTransform(config, progress)), filter: "none" };
  }
  if (config.entranceAnimation === "slide") {
    return { opacity: progress, transform: `translateY(${(1 - progress) * 16}px) scale(1)`, filter: "none" };
  }
  if (config.entranceAnimation === "flip") {
    return {
      opacity: progress,
      transform: `perspective(360px) rotateX(${(1 - progress) * -72}deg) scale(${interpolate(progress, 0, 1, 0.96, 1)})`,
      filter: "none",
    };
  }

  return { opacity: 1, transform: "translateY(0) scale(1)" };
}

function buildTimedWords(activeCaption: Caption): TimedCaptionWord[] {
  const renderableWords = getRenderableCaptionWords(activeCaption);
  if (renderableWords.length) {
    return renderableWords.map((word) => ({ ...word, word: getWordDisplayText(word) }));
  }

  const tokens = activeCaption.text.split(/\s+/).filter(Boolean);
  const duration = Math.max(0.08, activeCaption.end - activeCaption.start);
  return tokens.map((word, index) => {
    const start = activeCaption.start + (duration / Math.max(1, tokens.length)) * index;
    return {
      word,
      displayedWord: word,
      originalWord: word,
      start,
      end: start + duration / Math.max(1, tokens.length),
      score: 0,
    };
  });
}

function classifyMrBeastWord(word: string, config: CaptionStyleConfig) {
  if (!config.smartHighlightEnabled) return config.textColor;
  const clean = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  const money = new Set(["money", "cash", "dollar", "rupee", "lakh", "crore", "win", "winning", "prize"]);
  const shock = new Set(["today", "now", "fast", "secret", "surprise", "insane", "crazy"]);
  const danger = new Set(["fail", "mistake", "danger", "lose", "lost", "wrong", "problem"]);
  if (money.has(clean)) return config.emphasisGreenColor || "#00FF00";
  if (shock.has(clean)) return config.emphasisYellowColor || "#FFFF00";
  if (danger.has(clean)) return config.emphasisRedColor || "#FF0000";
  return config.textColor;
}

function mrBeastPopScale(ageFrames: number, config: CaptionStyleConfig) {
  if (ageFrames < 0) return 0;
  const peak = Math.max(1.02, config.activeWordScale);
  const undershoot = Math.max(0.9, 1 - config.animationStrength * 0.035);
  if (ageFrames <= 1) return interpolate(ageFrames, 0, 1, 0, peak);
  if (ageFrames <= 3) return interpolate(ageFrames, 1, 3, peak, undershoot);
  if (ageFrames <= 5) return interpolate(ageFrames, 3, 5, undershoot, 1);
  return 1;
}

function renderMrBeastStyle(
  activeCaption: Caption,
  currentTime: number,
  fps: number,
  scale: number,
  styleConfig?: Partial<CaptionStyleConfig> | null,
  canvasSize?: CaptionCanvasSize
) {
  const config = normalizeCaptionStyleConfig(styleConfig);
  const words = buildTimedWords(activeCaption);
  const layout = resolveSafeCaptionLayout(config, { canvas: canvasSize, previewScale: scale, words });
  const fontSize = layout.fontSize;
  const positionStyle = buildConfigPositionStyle(config, layout);
  const strokeWidth = config.textStrokeEnabled ? Math.max(0.5, config.textStrokeWidth * scale) : 0;
  const shadow = buildConfigTextShadow(config);

  return (
    <div style={positionStyle} data-caption-theme="mrbeast_style">
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: justifyFromAlignment(config.alignment),
          alignItems: "center",
          maxWidth: "100%",
          gap: "0.18em",
          textAlign: config.alignment,
          lineHeight: config.lineHeight,
          ...SAFE_CAPTION_TEXT_STYLE,
        }}
      >
        {words.map((word, index) => {
          const ageFrames = (currentTime - word.start) * fps;
          const visible = currentTime >= word.start;
          const entrance = wordEntranceStyle(word.start, currentTime, fps, config);
          const popScale = config.animationType === "none" ? 1 : mrBeastPopScale(ageFrames, config);
          const tiltSeed = stableHash(`${activeCaption.id}-${word.originalWord || word.word}-${index}`);
          const tilt = config.randomTiltEnabled ? (tiltSeed % 61) / 10 - 3 : 0;
          return (
            <span
              key={`${activeCaption.id}-mb-${index}-${word.start}`}
              style={{
                display: "inline-block",
                fontFamily: resolveFontFamily(config.fontFamily),
                fontSize,
                fontWeight: config.fontWeight,
                letterSpacing: `${config.letterSpacing}px`,
                color: classifyMrBeastWord(word.word, config),
                textTransform: "uppercase",
                WebkitTextStroke: strokeWidth ? `${strokeWidth}px ${config.textStrokeColor}` : undefined,
                paintOrder: strokeWidth ? "stroke fill" : undefined,
                textShadow: shadow,
                opacity: visible ? entrance.opacity ?? 1 : 0,
                transform: combineTransforms(`rotate(${tilt}deg)`, entrance.transform || "", `scale(${popScale})`),
                transformOrigin: "50% 58%",
                ...SAFE_CAPTION_TEXT_STYLE,
              }}
            >
              {word.word}
            </span>
          );
        })}
      </div>
    </div>
  );
function dynamicPunchSpringPop(elapsedMs: number, wordDurationSeconds: number): { scale: number; opacity: number } {
  if (elapsedMs < 0) return { scale: 0.5, opacity: 0 };

  const wordDurationMs = wordDurationSeconds * 1000;
  const defaultAnimMs = 120;
  const animMs = Math.max(30, Math.min(defaultAnimMs, wordDurationMs * 0.65));

  if (elapsedMs >= animMs) {
    return { scale: 1.0, opacity: 1 };
  }

  const t = elapsedMs / animMs;
  const peakT = 0.48;

  if (t <= peakT) {
    const phaseT = t / peakT;
    const easeProgress = 1 - Math.pow(1 - phaseT, 2);
    const scale = 0.50 + (1.15 - 0.50) * easeProgress;
    const opacity = Math.min(1, phaseT * 2.5);
    return { scale, opacity };
  } else {
    const phaseT = (t - peakT) / (1 - peakT);
    const easeProgress = 1 - Math.pow(1 - phaseT, 2);
    const scale = 1.15 - (1.15 - 1.00) * easeProgress;
    return { scale, opacity: 1 };
  }
}

function classifyDynamicPunchWord(word: string, index: number, captionId: string, config: CaptionStyleConfig) {
  if (!config.smartHighlightEnabled) return config.textColor || "#FFFFFF";
  const clean = word.toLowerCase().replace(/[^a-z0-9$%:.]/g, "");

  if (/^[₹$€£]?\d+([:.,]\d+)*%?$/i.test(clean) || /\d/.test(clean)) {
    return config.emphasisYellowColor || "#FFFF00";
  }

  const actionWords = new Set(["win", "winning", "go", "run", "fast", "grow", "yes", "free", "best", "boost", "build", "create", "action", "do"]);
  if (actionWords.has(clean)) {
    return config.emphasisGreenColor || "#39FF14";
  }

  const cyanWords = new Set(["secret", "magic", "insane", "crazy", "huge", "phone", "morning", "night", "check", "wakes", "time", "money", "world", "never", "always", "stop"]);
  if (cyanWords.has(clean)) {
    return config.activeWordColor || "#00FFFF";
  }

  const hash = stableHash(`dp-color-${captionId}-${word}-${index}`);
  const isFunctionWord = new Set(["a", "an", "the", "in", "on", "at", "to", "for", "of", "and", "or", "but", "is", "it", "he", "she", "my", "his", "her"]).has(clean);

  if (!isFunctionWord && hash % 100 < 32) {
    const colorChoice = hash % 3;
    if (colorChoice === 0) return config.activeWordColor || "#00FFFF";
    if (colorChoice === 1) return config.emphasisYellowColor || "#FFFF00";
    return config.emphasisGreenColor || "#39FF14";
  }

  return config.textColor || "#FFFFFF";
}

function renderDynamicPunchStyle(
  activeCaption: Caption,
  currentTime: number,
  fps: number,
  scale: number,
  styleConfig?: Partial<CaptionStyleConfig> | null,
  canvasSize?: CaptionCanvasSize
) {
  const config = normalizeCaptionStyleConfig(styleConfig);
  const words = buildTimedWords(activeCaption);
  const layout = resolveSafeCaptionLayout(config, { canvas: canvasSize, previewScale: scale, words });
  const fontSize = layout.fontSize;
  const positionStyle = buildConfigPositionStyle(config, layout);

  const strokeWidth = config.textStrokeEnabled !== false
    ? Math.max(1, fontSize * 0.10)
    : 0;

  const shadowOffset = Math.max(2, Math.round(fontSize * 0.045));
  const shadow = config.textShadowEnabled !== false
    ? `${shadowOffset}px ${shadowOffset}px 0px ${config.textShadowColor || "#000000"}`
    : undefined;

  const captionDuration = Math.max(0.08, activeCaption.end - activeCaption.start);

  return (
    <div style={positionStyle} data-caption-theme="dynamic_punch">
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: justifyFromAlignment(config.alignment),
          alignItems: "center",
          maxWidth: "100%",
          gap: "0.22em",
          textAlign: config.alignment,
          lineHeight: config.lineHeight || 0.95,
          ...SAFE_CAPTION_TEXT_STYLE,
        }}
      >
        {words.map((word, index) => {
          const elapsedMs = Math.max(0, (currentTime - activeCaption.start) * 1000);
          const { scale: animScale, opacity } = dynamicPunchSpringPop(elapsedMs, captionDuration);
          const color = classifyDynamicPunchWord(word.word, index, activeCaption.id, config);

          const isEmphasized = color !== (config.textColor || "#FFFFFF");
          const tiltHash = stableHash(`dp-tilt-${activeCaption.id}-${word.word}-${index}`);
          const tilt = (config.randomTiltEnabled !== false && isEmphasized && (tiltHash % 100 < 35))
            ? ((tiltHash % 61) / 10 - 3)
            : 0;

          const textTransform = config.textTransform === "uppercase"
            ? "uppercase"
            : config.textTransform === "lowercase"
            ? "lowercase"
            : "none";

          return (
            <span
              key={`${activeCaption.id}-dp-${index}-${word.start}`}
              style={{
                display: "inline-block",
                fontFamily: resolveFontFamily(config.fontFamily || "Montserrat"),
                fontSize,
                fontWeight: config.fontWeight || 900,
                letterSpacing: `${config.letterSpacing || 0}px`,
                color,
                textTransform,
                WebkitTextStroke: strokeWidth ? `${strokeWidth}px ${config.textStrokeColor || "#000000"}` : undefined,
                paintOrder: strokeWidth ? "stroke fill" : undefined,
                textShadow: shadow,
                opacity,
                transform: `rotate(${tilt}deg) scale(${animScale * (config.scale || 1)})`,
                transformOrigin: "center center",
                ...SAFE_CAPTION_TEXT_STYLE,
              }}
            >
              {word.word}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function renderAppleCinematic(
  activeCaption: Caption,
  currentTime: number,
  fps: number,
  scale: number,
  styleConfig?: Partial<CaptionStyleConfig> | null,
  canvasSize?: CaptionCanvasSize
) {
  const config = normalizeCaptionStyleConfig(styleConfig);
  const words = buildTimedWords(activeCaption);
  const layout = resolveSafeCaptionLayout(config, { canvas: canvasSize, previewScale: scale, words });
  const fontSize = layout.fontSize;
  const positionStyle = buildConfigPositionStyle(config, layout);
  const revealDuration = config.revealDuration || 0.32;
  const yOffset = (config.revealYOffset || 30) * scale;
  const blur = config.revealBlur || 25;
  const stroke = config.textStrokeEnabled ? `${Math.max(0.5, config.textStrokeWidth * scale)}px ${config.textStrokeColor}` : undefined;

  return (
    <div style={positionStyle} data-caption-theme="apple_cinematic">
      <div
        style={{
          maxWidth: "100%",
          textAlign: config.alignment,
          lineHeight: config.lineHeight,
          fontFamily: resolveFontFamily(config.fontFamily),
          fontSize,
          fontWeight: config.fontWeight,
          letterSpacing: `${config.letterSpacing}px`,
          color: config.textColor,
          textShadow: buildConfigTextShadow(config),
          ...SAFE_CAPTION_TEXT_STYLE,
        }}
      >
        {words.map((word, index) => {
          const progress = easeOutExpo((currentTime - word.start) / revealDuration);
          const entrance = wordEntranceStyle(word.start, currentTime, fps, config);
          return (
            <span
              key={`${activeCaption.id}-apple-${index}-${word.start}`}
              style={{
                display: "inline-block",
                marginRight: "0.28em",
                opacity: Number(entrance.opacity ?? 1) * progress,
                transform: combineTransforms(entrance.transform || "", `translateY(${(1 - progress) * yOffset}px)`),
                filter: config.entranceAnimation === "flip" ? entrance.filter || "none" : `blur(${(1 - progress) * blur}px)`,
                WebkitTextStroke: stroke,
                paintOrder: stroke ? "stroke fill" : undefined,
                ...SAFE_CAPTION_TEXT_STYLE,
              }}
            >
              {word.word}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function isPunctuationOnly(word: string) {
  return /^[^a-z0-9]+$/i.test(word.trim());
}

function normalizeLockupWords(words: TimedCaptionWord[]) {
  const normalized: TimedCaptionWord[] = [];
  for (const word of words) {
    const text = word.word.trim();
    if (!text) continue;
    if (isPunctuationOnly(text) && normalized.length > 0) {
      const previous = normalized[normalized.length - 1];
      normalized[normalized.length - 1] = { ...previous, word: `${previous.word}${text}`, end: Math.max(previous.end, word.end) };
    } else {
      normalized.push({ ...word, word: text });
    }
  }
  return normalized;
}

type ResolvedBuildLayoutMode = "left_anchor" | "center_anchor" | "right_anchor";

type LayoutBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type BuildWordRole = "anchor" | "supporting";

type EditorialWordPlacement = {
  id: string;
  index: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  scale: number;
  role: BuildWordRole;
  isAnchor: boolean;
};

type EditorialLockupLayout = {
  width: number;
  height: number;
  bounds: LayoutBounds;
  collisionPadding: number;
  fallback: boolean;
  placements: EditorialWordPlacement[];
};

type BuildWordGroup = {
  words: TimedCaptionWord[];
  groupIndex: number;
  start: number;
  end: number;
};

const BUILD_REVEAL_MIN_STEP_SECONDS = 0.11;
const BUILD_REVEAL_MAX_STEP_SECONDS = 0.38;
const BUILD_REVEAL_FLAT_START_EPSILON = 0.035;
const BUILD_SUPPORT_MIN_RATIO = 0.42;

const BUILD_CONNECTOR_WORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "of",
  "in",
  "and",
  "i",
  "lo",
  "ki",
  "ga",
  "tho",
  "ka",
  "ko",
  "ni",
  "me",
  "ne",
  "ye",
]);

function modernCanvasSize(canvasSize?: CaptionCanvasSize) {
  return {
    width: Math.max(1, canvasSize?.width || 1080),
    height: Math.max(1, canvasSize?.height || 1920),
  };
}

function normalizeBuildLayoutMode(mode: CaptionStyleConfig["layoutMode"]): "auto" | ResolvedBuildLayoutMode {
  if (mode === "a") return "center_anchor";
  if (mode === "b") return "left_anchor";
  if (mode === "c") return "right_anchor";
  if (mode === "top_heavy" || mode === "bottom_stack") return "center_anchor";
  if (mode === "split_lockup") return "right_anchor";
  if (mode === "left_anchor" || mode === "center_anchor" || mode === "right_anchor" || mode === "auto") {
    return mode;
  }
  return "auto";
}

function autoBuildLayoutMode(captionId: string, groupIndex: number): ResolvedBuildLayoutMode {
  const options: ResolvedBuildLayoutMode[] = ["left_anchor", "center_anchor", "right_anchor"];
  return options[stableHash(`${captionId}-${groupIndex}`) % options.length];
}

function cleanedToken(word: string) {
  return word.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function chooseAnchorIndex(words: TimedCaptionWord[]) {
  if (words.length === 0) return 0;

  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  words.forEach((word, index) => {
    const clean = cleanedToken(word.word);
    const connectorPenalty = BUILD_CONNECTOR_WORDS.has(clean) ? -3.5 : 0;
    const lengthScore = Math.min(12, clean.length) * 1.1;
    const numberBoost = /\d/.test(clean) ? 2.8 : 0;
    const emphasisBoost = /[!?]/.test(word.word) ? 1.4 : 0;
    const firstWordBoost = index === 0 ? 0.45 : 0;
    const score = lengthScore + numberBoost + emphasisBoost + firstWordBoost + connectorPenalty;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function buildEditorialWordGroups(words: TimedCaptionWord[], captionEnd: number): BuildWordGroup[] {
  const groups: BuildWordGroup[] = [];
  let index = 0;

  while (index < words.length) {
    const remaining = words.length - index;
    const size = remaining <= 4 ? remaining : remaining === 5 ? 3 : 3;
    const groupWords = words.slice(index, index + size);
    if (!groupWords.length) break;
    const groupStart = groupWords[0].start;
    const naturalGroupEnd = words[index + size]?.start ?? captionEnd;
    const lastWordEnd = Math.max(...groupWords.map((word) => word.end));
    const minimumReadableEnd = groupStart + BUILD_REVEAL_MIN_STEP_SECONDS * Math.max(1, groupWords.length);
    groups.push({
      words: groupWords,
      groupIndex: groups.length,
      start: groupStart,
      end: Math.max(groupStart + 0.08, Math.min(captionEnd, Math.max(naturalGroupEnd, lastWordEnd, minimumReadableEnd))),
    });
    index += size;
  }

  return groups;
}

function selectEditorialWordGroup(words: TimedCaptionWord[], activeCaption: Caption, currentTime: number) {
  const groups = buildEditorialWordGroups(words, activeCaption.end);
  if (!groups.length) return null;

  const activeGroup = groups.find((group) => currentTime >= group.start && currentTime < group.end);
  if (activeGroup) return activeGroup;

  const latestStarted = [...groups].reverse().find((group) => currentTime >= group.start);
  return latestStarted || groups[0];
}

function hasFlatEditorialTiming(words: TimedCaptionWord[]) {
  if (words.length <= 1) return false;
  const starts = words.map((word) => word.start);
  const firstStart = starts[0];
  const lastStart = starts[starts.length - 1];
  const compressedSpan = lastStart - firstStart < BUILD_REVEAL_MIN_STEP_SECONDS * Math.min(2, words.length - 1);
  const repeatedStart = starts.some((start, index) => index > 0 && Math.abs(start - starts[index - 1]) <= BUILD_REVEAL_FLAT_START_EPSILON);
  return compressedSpan || repeatedStart;
}

function buildEditorialRevealWords(
  words: TimedCaptionWord[],
  captionStart: number,
  captionEnd: number,
  preserveExactWordTiming: boolean
) {
  if (words.length <= 1) return words;
  if (preserveExactWordTiming) return words;

  const flatTiming = hasFlatEditorialTiming(words);
  const safeCaptionStart = Math.max(0, captionStart);
  const safeCaptionEnd = Math.max(safeCaptionStart + 0.08, captionEnd);
  const availableDuration = Math.max(0.08, safeCaptionEnd - safeCaptionStart);
  const step = clamp(
    availableDuration / Math.max(1, words.length + 0.5),
    BUILD_REVEAL_MIN_STEP_SECONDS,
    BUILD_REVEAL_MAX_STEP_SECONDS
  );

  let cursor = Math.max(safeCaptionStart, Math.min(words[0].start, safeCaptionEnd - 0.04));
  return words.map((word, index) => {
    const desiredStart = flatTiming
      ? safeCaptionStart + step * index
      : Math.max(word.start, index === 0 ? safeCaptionStart : cursor);
    const start = Math.min(Math.max(safeCaptionStart, desiredStart), safeCaptionEnd - 0.02);
    const nextNaturalStart = words[index + 1]?.start;
    const nextScheduledStart = index + 1 < words.length
      ? Math.min(safeCaptionEnd, Math.max(start + BUILD_REVEAL_MIN_STEP_SECONDS, flatTiming ? safeCaptionStart + step * (index + 1) : nextNaturalStart ?? start + step))
      : safeCaptionEnd;
    const end = Math.min(
      safeCaptionEnd,
      Math.max(start + 0.06, Math.min(word.end, nextScheduledStart))
    );
    cursor = nextScheduledStart;
    return {
      ...word,
      start: roundTime(start),
      end: roundTime(Math.max(start + 0.04, end)),
    };
  });
}

function estimateWordBox(word: string, fontSize: number, config: CaptionStyleConfig, wordScale = 1) {
  const token = word.trim();
  const charCount = Math.max(1, token.length);
  const factor = Number(config.fontWeight) >= 800 ? 0.64 : 0.58;
  const effectiveFontSize = fontSize * wordScale;
  const width = Math.max(
    effectiveFontSize * 0.78,
    charCount * effectiveFontSize * factor + Math.max(0, charCount - 1) * config.letterSpacing
  );
  const height = Math.max(effectiveFontSize * 0.9, effectiveFontSize * clamp(config.lineHeight, 0.9, 1.25));
  return { width, height };
}

function clampCenter(x: number, y: number, width: number, height: number, bounds: LayoutBounds) {
  if (width > bounds.right - bounds.left || height > bounds.bottom - bounds.top) {
    return {
      x: (bounds.left + bounds.right) / 2,
      y: (bounds.top + bounds.bottom) / 2,
    };
  }
  return {
    x: clamp(x, bounds.left + width / 2, bounds.right - width / 2),
    y: clamp(y, bounds.top + height / 2, bounds.bottom - height / 2),
  };
}

function placementRect(placement: EditorialWordPlacement) {
  return {
    left: placement.x - placement.width / 2,
    top: placement.y - placement.height / 2,
    right: placement.x + placement.width / 2,
    bottom: placement.y + placement.height / 2,
  };
}

function rectsOverlap(a: EditorialWordPlacement, b: EditorialWordPlacement, padding: number) {
  const aRect = placementRect(a);
  const bRect = placementRect(b);
  return (
    aRect.left < bRect.right + padding &&
    aRect.right > bRect.left - padding &&
    aRect.top < bRect.bottom + padding &&
    aRect.bottom > bRect.top - padding
  );
}

function isInsideSafeArea(placement: EditorialWordPlacement, bounds: LayoutBounds) {
  const rect = placementRect(placement);
  return rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom;
}

function hasCollision(placement: EditorialWordPlacement, existing: EditorialWordPlacement[], padding: number) {
  return existing.some((candidate) => rectsOverlap(placement, candidate, padding));
}

function makeWordPlacement(
  word: TimedCaptionWord,
  index: number,
  fontSize: number,
  x: number,
  y: number,
  role: BuildWordRole,
  config: CaptionStyleConfig,
  wordScale = 1
): EditorialWordPlacement {
  const size = estimateWordBox(word.word, fontSize, config, wordScale);
  return {
    id: `${index}:${word.start}:${word.word}`,
    index,
    text: word.word,
    x,
    y,
    width: size.width,
    height: size.height,
    fontSize,
    scale: wordScale,
    role,
    isAnchor: role === "anchor",
  };
}

function isValidBuildPlacement(
  placement: EditorialWordPlacement,
  existing: EditorialWordPlacement[],
  bounds: LayoutBounds,
  padding: number
) {
  return isInsideSafeArea(placement, bounds) && !hasCollision(placement, existing, padding);
}

function supportSlotCenters(
  mode: ResolvedBuildLayoutMode,
  anchor: EditorialWordPlacement,
  bounds: LayoutBounds,
  wordWidth: number,
  wordHeight: number,
  padding: number,
  tightness: number,
  _asymmetry: number,
  _seed: number,
  supportOrder: number
) {
  const anchorRect = placementRect(anchor);
  const safeWidth = bounds.right - bounds.left;
  const safeHeight = bounds.bottom - bounds.top;
  const gap = Math.max(padding, interpolate(clamp(tightness, 0, 10), 0, 10, 22, 3));
  const nudgeX = Math.min(safeWidth * 0.035, gap * 1.8);
  const nudgeY = Math.min(safeHeight * 0.045, gap * 1.6);
  const centerX = (bounds.left + bounds.right) / 2;
  const above = anchorRect.top - gap - wordHeight / 2;
  const below = anchorRect.bottom + gap + wordHeight / 2;
  const leftNear = anchorRect.left + wordWidth * 0.55;
  const rightNear = anchorRect.right - wordWidth * 0.55;
  const leftTuck = anchorRect.left + Math.min(anchor.width * 0.25, wordWidth * 1.1);
  const rightTuck = anchorRect.right - Math.min(anchor.width * 0.25, wordWidth * 1.1);

  const templates: Record<ResolvedBuildLayoutMode, Array<{ x: number; y: number }>> = {
    left_anchor: [
      { x: rightTuck, y: above },
      { x: leftNear, y: below },
      { x: rightNear, y: below },
    ],
    center_anchor: [
      { x: rightTuck, y: above },
      { x: leftNear, y: below },
      { x: rightNear, y: below },
    ],
    right_anchor: [
      { x: leftTuck, y: above },
      { x: leftNear, y: below },
      { x: rightNear, y: below },
    ],
  };

  const primary = templates[mode][supportOrder % 3];
  const secondary = [
    primary,
    { x: primary.x - nudgeX, y: primary.y },
    { x: primary.x + nudgeX, y: primary.y },
    { x: primary.x, y: primary.y - nudgeY },
    { x: primary.x, y: primary.y + nudgeY },
    { x: anchor.x, y: above },
    { x: anchor.x, y: below },
    { x: centerX, y: supportOrder === 0 ? above : below },
  ];

  return secondary;
}

function buildFallbackStackLayout(
  words: TimedCaptionWord[],
  anchorIndex: number,
  config: CaptionStyleConfig,
  bounds: LayoutBounds,
  bigFontSize: number,
  smallFontSize: number,
  collisionPadding: number
) {
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  const availableWidth = Math.max(1, bounds.right - bounds.left);
  const availableHeight = Math.max(1, bounds.bottom - bounds.top);
  const rowGap = Math.max(collisionPadding, smallFontSize * 0.08);
  const supportIndexes = words.map((_, index) => index).filter((index) => index !== anchorIndex);
  const split = Math.ceil(supportIndexes.length / 2);
  const rows = [
    supportIndexes.slice(0, split),
    [anchorIndex],
    supportIndexes.slice(split),
  ].filter((row) => row.length > 0);
  const lockupScaleAttempts = [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.52, 0.44, 0.36, 0.3, 0.24, 0.2, 0.16, 0.12, 0.08];

  const buildRows = (globalScale: number) => rows.map((row) => {
    const items = row.map((index) => {
      const isAnchor = index === anchorIndex;
      const fontSize = (isAnchor ? bigFontSize : smallFontSize) * globalScale;
      const size = estimateWordBox(words[index].word, fontSize, config);
      return { index, isAnchor, fontSize, ...size };
    });
    return {
      items,
      width: items.reduce((total, item) => total + item.width, 0) + Math.max(0, items.length - 1) * collisionPadding,
      height: Math.max(1, ...items.map((item) => item.height)),
    };
  });

  let resolvedRows = buildRows(lockupScaleAttempts[lockupScaleAttempts.length - 1]);
  for (const lockupScale of lockupScaleAttempts) {
    const candidateRows = buildRows(lockupScale);
    const candidateHeight = candidateRows.reduce((total, row) => total + row.height, 0) + Math.max(0, candidateRows.length - 1) * rowGap;
    const candidateWidth = Math.max(1, ...candidateRows.map((row) => row.width));
    resolvedRows = candidateRows;
    if (candidateWidth <= availableWidth && candidateHeight <= availableHeight) {
      break;
    }
  }

  const totalHeight = resolvedRows.reduce((total, row) => total + row.height, 0) + Math.max(0, resolvedRows.length - 1) * rowGap;
  let y = centerY - totalHeight / 2;
  const placements: EditorialWordPlacement[] = [];

  resolvedRows.forEach((row) => {
    const rowY = y + row.height / 2;
    let x = centerX - row.width / 2;
    row.items.forEach((item) => {
      const center = {
        x: x + item.width / 2,
        y: rowY,
      };
      placements.push(makeWordPlacement(
        words[item.index],
        item.index,
        item.fontSize,
        center.x,
        center.y,
        item.isAnchor ? "anchor" : "supporting",
        config
      ));
      x += item.width + collisionPadding;
    });
    y += row.height + rowGap;
  });

  return placements;
}

function buildEditorialLockupLayout(
  words: TimedCaptionWord[],
  activeCaption: Caption,
  config: CaptionStyleConfig,
  layout: SafeCaptionLayout,
  canvasSize: CaptionCanvasSize | undefined,
  scale: number,
  groupIndex = 0
): EditorialLockupLayout {
  const canvas = modernCanvasSize(canvasSize);
  const width = Math.max(1, canvas.width * scale * (layout.widthPercent / 100));
  const height = Math.max(1, canvas.height * scale * (layout.maxHeightPercent / 100));
  const safeMarginPercent = config.safeAreaEnabled ? clamp(config.layoutSafeMarginPercent ?? 8, 0, 20) : 0;
  const bounds: LayoutBounds = {
    left: (width * safeMarginPercent) / 100,
    top: (height * safeMarginPercent) / 100,
    right: width - (width * safeMarginPercent) / 100,
    bottom: height - (height * safeMarginPercent) / 100,
  };

  const collisionPadding = Math.max(0, (config.collisionPadding ?? 8) * scale);
  const safeWidth = Math.max(1, bounds.right - bounds.left);
  const safeHeight = Math.max(1, bounds.bottom - bounds.top);
  const configuredBigFontSize = clamp(config.bigFontSizePx ?? BUILD_BIG_FONT_SIZE_PX, 80, 400) * scale;
  const configuredSmallFontSize = Math.min(
    configuredBigFontSize * 0.78,
    Math.max(
      configuredBigFontSize * BUILD_SUPPORT_MIN_RATIO,
      clamp(config.smallFontSizePx ?? BUILD_SMALL_FONT_SIZE_PX, 20, 160) * scale
    )
  );
  const tightness = clamp(config.tightness ?? 0.75, 0, 10);
  const modeInput = normalizeBuildLayoutMode(config.layoutMode);
  const mode = modeInput === "auto" ? autoBuildLayoutMode(activeCaption.id, groupIndex) : modeInput;
  const anchorIndex = chooseAnchorIndex(words);
  const anchorWord = words[anchorIndex];
  const lockupScaleAttempts = [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.52, 0.44, 0.36, 0.3, 0.24, 0.2, 0.16, 0.12, 0.08];

  const modeAnchorCenter = (currentMode: ResolvedBuildLayoutMode) => {
    const midX = (bounds.left + bounds.right) / 2;
    const midY = (bounds.top + bounds.bottom) / 2;
    if (currentMode === "left_anchor") {
      return { x: bounds.left + safeWidth * 0.43, y: midY + safeHeight * 0.02 };
    }
    if (currentMode === "right_anchor") {
      return { x: bounds.left + safeWidth * 0.57, y: midY - safeHeight * 0.01 };
    }
    return { x: midX, y: midY };
  };

  const isNearAnchor = (placement: EditorialWordPlacement, anchor: EditorialWordPlacement) => {
    const placementBounds = placementRect(placement);
    const anchorBounds = placementRect(anchor);
    const xGap = Math.max(anchorBounds.left - placementBounds.right, placementBounds.left - anchorBounds.right, 0);
    const yGap = Math.max(anchorBounds.top - placementBounds.bottom, placementBounds.top - anchorBounds.bottom, 0);
    return Math.hypot(xGap, yGap) <= Math.max(safeHeight * 0.2, collisionPadding * 2);
  };

  const placeSupportWord = (
    index: number,
    supportOrder: number,
    mode: ResolvedBuildLayoutMode,
    anchor: EditorialWordPlacement,
    placements: EditorialWordPlacement[],
    fontSize: number
  ) => {
    const probe = makeWordPlacement(words[index], index, fontSize, 0, 0, "supporting", config);
    const slots = supportSlotCenters(
      mode,
      anchor,
      bounds,
      probe.width,
      probe.height,
      collisionPadding,
      tightness,
      0,
      0,
      supportOrder
    );

    for (const slot of slots) {
      const center = clampCenter(slot.x, slot.y, probe.width, probe.height, bounds);
      const candidate = makeWordPlacement(words[index], index, fontSize, center.x, center.y, "supporting", config);
      if (isValidBuildPlacement(candidate, placements, bounds, collisionPadding) && isNearAnchor(candidate, anchor)) {
        return candidate;
      }
    }

    return null;
  };

  for (const lockupScale of lockupScaleAttempts) {
    const anchorFont = configuredBigFontSize * lockupScale;
    const supportFont = configuredSmallFontSize * lockupScale;
    const baseAnchor = modeAnchorCenter(mode);
    const anchorProbe = makeWordPlacement(anchorWord, anchorIndex, anchorFont, 0, 0, "anchor", config);
    const anchorCenter = clampCenter(baseAnchor.x, baseAnchor.y, anchorProbe.width, anchorProbe.height, bounds);
    const anchor = makeWordPlacement(anchorWord, anchorIndex, anchorFont, anchorCenter.x, anchorCenter.y, "anchor", config);
    if (!isInsideSafeArea(anchor, bounds)) continue;

    const placements: EditorialWordPlacement[] = [anchor];
    const supportIndexes = words.map((_, index) => index).filter((index) => index !== anchorIndex);
    let failed = false;

    for (let supportOrder = 0; supportOrder < supportIndexes.length; supportOrder += 1) {
      const index = supportIndexes[supportOrder];
      const placement = placeSupportWord(index, supportOrder, mode, anchor, placements, supportFont);
      if (!placement) {
        failed = true;
        break;
      }
      placements.push(placement);
    }

    if (!failed) {
      return { width, height, bounds, collisionPadding, fallback: false, placements };
    }
  }

  const fallbackPlacements = buildFallbackStackLayout(
    words,
    anchorIndex,
    config,
    bounds,
    configuredBigFontSize,
    configuredSmallFontSize,
    collisionPadding
  );

  return {
    width,
    height,
    bounds,
    collisionPadding,
    fallback: true,
    placements: fallbackPlacements,
  };
}

function findBuildCollision(placements: EditorialWordPlacement[], padding: number) {
  for (let leftIndex = 0; leftIndex < placements.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < placements.length; rightIndex += 1) {
      if (rectsOverlap(placements[leftIndex], placements[rightIndex], padding)) {
        return [placements[leftIndex], placements[rightIndex]] as const;
      }
    }
  }
  return null;
}

function renderModernMinimalistLockup(
  activeCaption: Caption,
  currentTime: number,
  fps: number,
  scale: number,
  styleConfig?: Partial<CaptionStyleConfig> | null,
  canvasSize?: CaptionCanvasSize
) {
  if (currentTime < activeCaption.start || currentTime >= activeCaption.end) return null;

  const config = normalizeModernMinimalistStyleConfig(styleConfig);
  const allWords = buildEditorialRevealWords(
    normalizeLockupWords(buildTimedWords(activeCaption)),
    activeCaption.start,
    activeCaption.end,
    Boolean(activeCaption.words?.length)
  );
  const wordGroup = selectEditorialWordGroup(allWords, activeCaption, currentTime);
  if (!wordGroup) return null;

  const words = wordGroup.words;
  const anyRevealed = words.some((word) => currentTime >= word.start && currentTime < wordGroup.end);
  if (!anyRevealed) return null;

  const layoutSafety = resolveSafeCaptionLayout(config, {
    canvas: canvasSize,
    previewScale: scale,
    words,
    text: words.map((word) => word.word).join(" "),
    safety: {
      maxWidthPercent: 86,
      maxHeightPercent: 45,
      safeMarginPercent: 8,
      defaultFontSize: 112,
      minFontSize: 18,
      maxFontSize: 132,
      defaultScale: 1,
      minScale: 0,
      maxScale: 4,
      lineClamp: 2,
      wrapMode: "balanced",
    },
  });

  const lockup = buildEditorialLockupLayout(words, activeCaption, config, layoutSafety, canvasSize, scale, wordGroup.groupIndex);
  const positionStyle = buildConfigPositionStyle(config, layoutSafety);
  const stroke = config.textStrokeEnabled ? `${Math.max(0.5, config.textStrokeWidth * scale)}px ${config.textStrokeColor}` : undefined;
  const lineHeight = clamp(Number(config.lineHeight) || 0.95, 0.85, 1.2);
  const activeIndex = words.findIndex((word) => currentTime >= word.start && currentTime < word.end);
  const showBuildBounds = process.env.NODE_ENV !== "production" && Boolean(config.showBuildWordBounds);
  const debugCollision = showBuildBounds ? findBuildCollision(lockup.placements, lockup.collisionPadding) : null;
  if (debugCollision) {
    console.warn("[captions] Editorial Lockup collision", {
      captionId: activeCaption.id,
      words: debugCollision.map((placement) => placement.text),
      padding: lockup.collisionPadding,
    });
  }

  return (
    <div
      style={{
        ...positionStyle,
        height: `${layoutSafety.maxHeightPercent}%`,
      }}
      data-caption-theme="modern_minimalist_lockup"
    >
      <div
        style={{
          ...buildCaptionSurfaceStyle(config, scale),
          position: "relative",
          width: "100%",
          height: "100%",
          maxWidth: "100%",
          maxHeight: "100%",
          overflow: "hidden",
          ...SAFE_CAPTION_TEXT_STYLE,
        }}
      >
        {showBuildBounds && (
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: `${(lockup.bounds.left / lockup.width) * 100}%`,
              top: `${(lockup.bounds.top / lockup.height) * 100}%`,
              width: `${((lockup.bounds.right - lockup.bounds.left) / lockup.width) * 100}%`,
              height: `${((lockup.bounds.bottom - lockup.bounds.top) / lockup.height) * 100}%`,
              border: "1px dashed rgba(34, 244, 184, 0.9)",
              pointerEvents: "none",
              zIndex: 1,
            }}
          />
        )}
        {lockup.placements.map((placement) => {
          const word = words[placement.index];
          const visible = currentTime >= word.start && currentTime < wordGroup.end;
          const entrance = wordEntranceStyle(word.start, currentTime, fps, config);
          const isActive = placement.index === activeIndex;
          const glow = config.activeWordGlow && isActive ? `0 0 ${Math.round(12 * scale)}px ${config.activeWordColor}` : "";
          const textShadow = [buildConfigTextShadow(config), glow].filter(Boolean).join(", ") || undefined;

          return (
            <span
              key={`${activeCaption.id}-modern-lockup-${placement.index}-${word.start}`}
              style={{
                position: "absolute",
                left: `${(placement.x / lockup.width) * 100}%`,
                top: `${(placement.y / lockup.height) * 100}%`,
                display: "inline-block",
                fontFamily: resolveFontFamily(placement.isAnchor ? (config.bigFontFamily || config.fontFamily) : (config.smallFontFamily || config.fontFamily)),
                fontSize: placement.fontSize,
                fontWeight: Number(config.fontWeight) || 900,
                color: isActive ? config.activeWordColor : config.textColor,
                letterSpacing: `${config.letterSpacing}px`,
                lineHeight,
                textTransform: config.textTransform,
                textShadow,
                WebkitTextStroke: stroke,
                paintOrder: stroke ? "stroke fill" : undefined,
                opacity: visible ? entrance.opacity ?? 1 : 0,
                visibility: visible ? "visible" : "hidden",
                transform: visible
                  ? combineTransforms("translate(-50%, -50%)", entrance.transform || "")
                  : "translate(-50%, -50%) scale(1)",
                filter: entrance.filter || "none",
                transformOrigin: "50% 50%",
                whiteSpace: "nowrap",
                ...SAFE_CAPTION_TEXT_STYLE,
              }}
            >
              {word.word}
            </span>
          );
        })}
        {showBuildBounds && lockup.placements.map((placement) => {
          const rect = placementRect(placement);
          return (
            <div
              key={`${activeCaption.id}-bounds-${placement.index}`}
              aria-hidden
              style={{
                position: "absolute",
                left: `${(rect.left / lockup.width) * 100}%`,
                top: `${(rect.top / lockup.height) * 100}%`,
                width: `${(placement.width / lockup.width) * 100}%`,
                height: `${(placement.height / lockup.height) * 100}%`,
                border: placement.isAnchor ? "1px solid rgba(255, 212, 59, 0.95)" : "1px solid rgba(255, 90, 95, 0.9)",
                color: placement.isAnchor ? "#FFD43B" : "#FF5A5F",
                fontSize: Math.max(8, 10 * scale),
                lineHeight: 1,
                pointerEvents: "none",
                zIndex: 3,
              }}
            >
              {placement.role}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function renderKineticWords(
  activeCaption: Caption,
  currentTime: number,
  fps: number,
  _style: CaptionStyle,
  scale: number,
  styleConfig?: Partial<CaptionStyleConfig> | null,
  canvasSize?: CaptionCanvasSize
) {
  const config = normalizeCaptionStyleConfig(styleConfig);
  const tokens = buildTimedWords(activeCaption);
  const layout = resolveSafeCaptionLayout(config, { canvas: canvasSize, previewScale: scale, words: tokens, text: activeCaption.text });
  const fontSize = layout.fontSize;
  const textShadow = buildConfigTextShadow(config);
  const positionStyle = buildConfigPositionStyle(config, layout);

  return (
    <div style={positionStyle}>
      <div className="max-w-full leading-snug" style={{ textAlign: config.alignment, ...SAFE_CAPTION_TEXT_STYLE }}>
        {tokens.map((word, index) => {
          const progress = Math.max(0, Math.min(1, (currentTime - word.start) / 0.18));
          const entrance = wordEntranceStyle(word.start, currentTime, fps, config);
          const ageFrames = Math.max(0, (currentTime - word.start) * fps);
          const motion = wordMotionTransform(ageFrames, config);
          return (
            <span
              key={`${activeCaption.id}-kf-${index}`}
              style={{
                display: "inline-block",
                marginRight: "0.28em",
                fontSize,
                fontFamily: resolveFontFamily(config.fontFamily),
                fontWeight: config.fontWeight,
                color: config.textColor || "#fff",
                textShadow,
                WebkitTextStroke: config.textStrokeEnabled ? `${config.textStrokeWidth * scale}px ${config.textStrokeColor}` : undefined,
                paintOrder: config.textStrokeEnabled ? "stroke fill" : undefined,
                letterSpacing: `${config.letterSpacing}px`,
                textTransform: config.textTransform,
                opacity: Number(entrance.opacity ?? 1) * progress,
                transform: combineTransforms(entrance.transform || "", `translateY(${(1 - progress) * 10}px) scale(${0.92 + progress * 0.08})`, motion),
                ...SAFE_CAPTION_TEXT_STYLE,
              }}
            >
              {word.word}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function renderAttentionPunch(
  activeCaption: Caption,
  currentTime: number,
  fps: number,
  _style: CaptionStyle,
  scale: number,
  transition: boolean,
  styleConfig?: Partial<CaptionStyleConfig> | null,
  canvasSize?: CaptionCanvasSize
) {
  const config = normalizeCaptionStyleConfig(styleConfig);
  const words = buildTimedWords(activeCaption);
  const layout = resolveSafeCaptionLayout(config, { canvas: canvasSize, previewScale: scale, words, text: activeCaption.text });
  const fontSize = layout.fontSize;
  const positionStyle = buildConfigPositionStyle(config, layout);
  const activeIndex = words.findIndex((word) => currentTime >= word.start && currentTime < word.end);
  return (
    <div style={positionStyle}>
      <div className="flex max-w-full flex-wrap gap-x-[0.28em] leading-tight" style={{ justifyContent: justifyFromAlignment(config.alignment), ...SAFE_CAPTION_TEXT_STYLE }}>
        {words.map((word, index) => {
          const active = index === activeIndex;
          const spoken = currentTime >= word.start;
          const entrance = wordEntranceStyle(word.start, currentTime, fps, config);
          const ageFrames = Math.max(0, (currentTime - word.start) * fps);
          const motion = wordMotionTransform(ageFrames, config);
          const baseShadow = buildConfigTextShadow(config);
          const activeGlow = config.activeWordGlow && active ? `0 0 12px ${config.activeWordColor}` : "";
          const wordShadow = [baseShadow, activeGlow].filter(Boolean).join(", ") || undefined;
          return (
            <span
              key={`${activeCaption.id}-ap-${index}`}
              style={{
                display: "inline-block",
                fontSize,
                fontFamily: resolveFontFamily(config.fontFamily),
                fontWeight: config.fontWeight,
                color: active ? config.activeWordColor : config.textColor,
                letterSpacing: `${config.letterSpacing}px`,
                textTransform: config.textTransform,
                WebkitTextStroke: config.textStrokeEnabled ? `${config.textStrokeWidth * scale}px ${config.textStrokeColor}` : undefined,
                textShadow: wordShadow,
                opacity: spoken ? entrance.opacity ?? 1 : 0,
                transform: combineTransforms(
                  entrance.transform || "",
                  motion,
                  active ? `translateY(-2px) scale(${config.activeWordScale})` : "translateY(0) scale(1)"
                ),
                transition: transition ? "transform 100ms ease, color 90ms linear" : "none",
                ...SAFE_CAPTION_TEXT_STYLE,
              }}
            >
              {word.word}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function CaptionRenderer({
  captions,
  currentTime,
  fps = 30,
  scale = 1,
  transition = false,
  styleConfig,
  canvasSize,
}: Props) {
  const exactActiveCaption = [...captions]
    .filter((caption) => currentTime >= caption.start && currentTime < caption.end)
    .sort((a, b) => (b.start - a.start) || (a.end - b.end))[0];
  if (!exactActiveCaption) return null;
  const activeCaption = exactActiveCaption;

  const resolvedConfig = normalizeCaptionStyleConfig(styleConfig);

  if (activeCaption.theme === "word_highlight_box") {
    return (
      <WordHighlightBoxCaption
        caption={activeCaption}
        currentTime={currentTime}
        fps={fps}
        scale={scale}
        transition={transition}
        styleConfig={styleConfig}
        canvasSize={canvasSize}
      />
    );
  }

  if (activeCaption.theme === "kinetic_fade") {
    return renderKineticWords(activeCaption, currentTime, fps, CAPTION_THEMES.kinetic_fade, scale, styleConfig, canvasSize);
  }

  if (activeCaption.theme === "attention_punch") {
    return renderAttentionPunch(activeCaption, currentTime, fps, CAPTION_THEMES.attention_punch, scale, transition, styleConfig, canvasSize);
  }

  if (activeCaption.theme === "mrbeast_style") {
    return renderMrBeastStyle(activeCaption, currentTime, fps, scale, styleConfig, canvasSize);
  }

  if (activeCaption.theme === "dynamic_punch") {
    return renderDynamicPunchStyle(activeCaption, currentTime, fps, scale, styleConfig, canvasSize);
  }

  if (activeCaption.theme === "apple_cinematic") {
    return renderAppleCinematic(activeCaption, currentTime, fps, scale, styleConfig, canvasSize);
  }

  if (activeCaption.theme === "modern_minimalist_lockup") {
    return renderModernMinimalistLockup(activeCaption, currentTime, fps, scale, styleConfig, canvasSize);
  }

  if (activeCaption.theme === "viral_word_highlight") {
    return (
      <ViralWordHighlightCaption
        caption={activeCaption}
        currentTime={currentTime}
        fps={fps}
        scale={scale}
        transition={transition}
        styleConfig={resolvedConfig}
        canvasSize={canvasSize}
      />
    );
  }

  const themeStyle: CaptionStyle =
    activeCaption.style || CAPTION_THEMES[activeCaption.theme] || CAPTION_THEMES.minimal;
  const useConfigSurface = Boolean(styleConfig);
  const fallbackWords = getRenderableCaptionWords(activeCaption);
  const fallbackLayout = useConfigSurface
    ? resolveSafeCaptionLayout(resolvedConfig, { canvas: canvasSize, previewScale: scale, words: fallbackWords, text: activeCaption.text })
    : undefined;
  const positionStyle = useConfigSurface ? buildConfigPositionStyle(resolvedConfig, fallbackLayout) : buildPositionStyle(themeStyle);
  const textShadow = useConfigSurface ? buildConfigTextShadow(resolvedConfig) : buildTextShadow(themeStyle);
  const fontSize = useConfigSurface
    ? fallbackLayout?.fontSize || Math.max(0, Math.round(resolvedConfig.fontSize * scale))
    : Math.max(0, Math.round((themeStyle.fontSize || 24) * scale));
  const isOutlineBold = activeCaption.theme === "outline_bold";
  const hasGradient = !useConfigSurface && !!themeStyle.gradient;
  const normalColor = hasGradient
    ? "transparent"
    : useConfigSurface
    ? resolvedConfig.textColor
    : isOutlineBold
    ? "transparent"
    : themeStyle.color || "#ffffff";
  const highlightColor = useConfigSurface ? resolvedConfig.activeWordColor : HIGHLIGHT_COLORS[activeCaption.theme] || "#FFD700";
  const fallbackSurfaceStyle = useConfigSurface
    ? buildCaptionSurfaceStyle(resolvedConfig, scale)
    : {
        backgroundColor: themeStyle.backgroundColor || "transparent",
        borderRadius: themeStyle.borderRadius || "4px",
        padding: themeStyle.padding || "6px 12px",
      };
  const fallbackFontFamily = useConfigSurface ? resolveFontFamily(resolvedConfig.fontFamily) : themeStyle.fontFamily;
  const fallbackFontWeight = useConfigSurface ? resolvedConfig.fontWeight : themeStyle.bold ? 700 : 400;
  const fallbackTextTransform = useConfigSurface ? resolvedConfig.textTransform : themeStyle.textTransform || "none";
  const fallbackLetterSpacing = useConfigSurface ? `${resolvedConfig.letterSpacing}px` : themeStyle.letterSpacing || "normal";
  const fallbackAlignment = useConfigSurface ? resolvedConfig.alignment : "center";
  const fallbackMaxLines = useConfigSurface && resolvedConfig.maxLines !== "auto" ? resolvedConfig.maxLines : fallbackLayout?.lineClamp;

  if (fallbackWords.length > 0) {
    return (
      <div className={useConfigSurface ? "pointer-events-none" : "absolute left-0 right-0 flex justify-center pointer-events-none px-4"} style={positionStyle}>
        <div
          className="max-w-[85%] flex flex-wrap justify-center gap-x-[0.3em] items-baseline"
          style={{
            ...fallbackSurfaceStyle,
            justifyContent: justifyFromAlignment(fallbackAlignment),
            maxHeight: fallbackMaxLines ? `${Math.ceil(fontSize * resolvedConfig.lineHeight * fallbackMaxLines)}px` : fallbackLayout ? "100%" : undefined,
            overflow: "hidden",
            ...SAFE_CAPTION_TEXT_STYLE,
            ...(themeStyle.backdropBlur
              ? {
                  backdropFilter: `blur(${themeStyle.backdropBlur}px)`,
                  WebkitBackdropFilter: `blur(${themeStyle.backdropBlur}px)`,
                  border: "1px solid rgba(255,255,255,0.15)",
                }
              : {}),
          }}
        >
          {fallbackWords.map((word, idx) => {
            const isSpoken = currentTime >= word.start;
            const isActive = currentTime >= word.start && currentTime < word.end;
            const ageFrames = Math.max(0, (currentTime - word.start) * fps);
            const motion = wordMotionTransform(ageFrames, resolvedConfig);
            const entrance = wordEntranceStyle(word.start, currentTime, fps, resolvedConfig);
            return (
              <span
                key={`${activeCaption.id}-w${idx}`}
                className="word-pop"
                style={{
                  fontFamily: fallbackFontFamily,
                  fontWeight: fallbackFontWeight,
                  fontStyle: themeStyle.italic ? "italic" : "normal",
                  textShadow,
                  textTransform: fallbackTextTransform,
                  letterSpacing: fallbackLetterSpacing,
                  ...(isOutlineBold ? { WebkitTextStroke: "2px #ffffff" } : {}),
                  fontSize,
                  display: "inline-block",
                  color: isActive ? highlightColor : isSpoken ? normalColor : "rgba(255,255,255,0.15)",
                  opacity: isSpoken ? entrance.opacity ?? 1 : 0,
                  transform: isSpoken
                    ? combineTransforms(
                        entrance.transform || "",
                        motion,
                        isActive ? "scale(1.15) translateY(-1px)" : "scale(1)"
                      )
                    : "scale(0.6) translateY(8px)",
                  transition: transition ? "all 0.12s cubic-bezier(0.34, 1.56, 0.64, 1)" : "none",
                  ...SAFE_CAPTION_TEXT_STYLE,
                  ...(hasGradient && isSpoken && !isActive
                    ? {
                        backgroundImage: themeStyle.gradient,
                        WebkitBackgroundClip: "text",
                        backgroundClip: "text",
                      }
                    : {}),
                }}
              >
                {getWordDisplayText(word)}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={useConfigSurface ? "pointer-events-none" : "absolute left-0 right-0 flex justify-center pointer-events-none px-4"} style={positionStyle}>
      <div
        className="max-w-[85%] text-center leading-snug"
        style={{
          ...fallbackSurfaceStyle,
          fontSize,
          fontFamily: fallbackFontFamily,
          fontWeight: fallbackFontWeight,
          fontStyle: themeStyle.italic ? "italic" : "normal",
          textShadow,
          textTransform: fallbackTextTransform,
          letterSpacing: fallbackLetterSpacing,
          ...(isOutlineBold ? { WebkitTextStroke: "2px #ffffff" } : {}),
          color: normalColor,
          textAlign: fallbackAlignment,
          maxHeight: fallbackMaxLines ? `${Math.ceil(fontSize * resolvedConfig.lineHeight * fallbackMaxLines)}px` : undefined,
          overflow: "hidden",
          ...SAFE_CAPTION_TEXT_STYLE,
          ...(hasGradient
            ? {
                backgroundImage: themeStyle.gradient,
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
              }
            : {}),
        }}
      >
        {getCaptionDisplayText(activeCaption)}
      </div>
    </div>
  );
}
