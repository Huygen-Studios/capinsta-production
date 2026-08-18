/* eslint-disable opencut/prefer-object-params -- Transplanted original Capinsta renderer logic is kept structurally faithful for visual parity. */
"use client";

import { AlignedWord, Caption, CaptionStyleConfig } from "./types";
import {
  CaptionCanvasSize,
  SAFE_CAPTION_TEXT_STYLE,
  buildSafeCaptionPositionStyle,
  resolveSafeCaptionLayout,
} from "./captionLayoutSafety";
import { normalizeCaptionStyleConfig, resolveFontFamily } from "./captionStyleConfig";
import { getActiveWordIndex, getRenderableCaptionWords, getWordDisplayText, wordActivationProgressFrames } from "./captionUtils";

interface Props {
  caption: Caption;
  currentTime: number;
  fps?: number;
  scale?: number;
  transition?: boolean;
  styleConfig?: Partial<CaptionStyleConfig> | null;
  canvasSize?: CaptionCanvasSize;
}

function interpolate(input: number, inMin: number, inMax: number, outMin: number, outMax: number) {
  const t = Math.max(0, Math.min(1, (input - inMin) / (inMax - inMin)));
  return outMin + (outMax - outMin) * t;
}

function activeWordTransform(word: AlignedWord, currentTime: number, fps: number) {
  const ageFrames = wordActivationProgressFrames(word, currentTime, fps);
  let scale = 1;
  let y = 0;

  if (ageFrames <= 2) {
    scale = interpolate(ageFrames, 0, 2, 0.92, 1.12);
    y = interpolate(ageFrames, 0, 2, 5, -3);
  } else if (ageFrames <= 7) {
    scale = interpolate(ageFrames, 2, 7, 1.12, 1);
    y = interpolate(ageFrames, 2, 7, -3, 0);
  }

  return `translateY(${y}px) scale(${scale})`;
}

function wordMotionTransform(ageFrames: number, config: CaptionStyleConfig) {
  if (config.animationType === "none" || config.animationStrength <= 0 || ageFrames < 0) {
    return "translateY(0) scale(1)";
  }

  const speed = Math.max(0.4, config.animationSpeed);
  const smoothness = Math.max(0, Math.min(1, config.animationSmoothness));
  const peakFrame = Math.max(2, (3 + smoothness * 2) / speed);
  const settleFrame = Math.max(peakFrame + 2, (8 + smoothness * 4) / speed);
  const maxScale = 1 + (config.activeWordScale - 1) * config.animationStrength;
  const lift = (config.animationType === "bounce" ? -4 : -2.5) * config.animationStrength;

  if (ageFrames <= peakFrame) {
    const t = ageFrames / peakFrame;
    const scale = 0.98 + (maxScale - 0.98) * t;
    const y = 5 * config.animationStrength + (lift - 5 * config.animationStrength) * t;
    return `translateY(${y}px) scale(${scale})`;
  }

  if (ageFrames <= settleFrame) {
    const t = (ageFrames - peakFrame) / Math.max(0.001, settleFrame - peakFrame);
    const settleScale = config.animationType === "bounce" ? 0.98 : 1;
    const scale = maxScale + (settleScale - maxScale) * t;
    const y = lift + (0 - lift) * t;
    return `translateY(${y}px) scale(${scale})`;
  }

  return "translateY(0) scale(1)";
}

function wordEntranceStyle(wordStart: number, currentTime: number, fps: number, config: CaptionStyleConfig) {
  if (currentTime < wordStart) return { opacity: 0, transform: "translateY(0) scale(1)" };
  if (config.entranceAnimation === "none") return { opacity: 1, transform: "translateY(0) scale(1)" };

  const ageFrames = Math.max(0, (currentTime - wordStart) * fps);
  const duration = Math.max(2, Math.round(8 / Math.max(0.4, config.animationSpeed)));
  const progress = Math.max(0, Math.min(1, ageFrames / duration));

  if (config.entranceAnimation === "fade") {
    return { opacity: progress, transform: "translateY(0) scale(1)" };
  }
  if (config.entranceAnimation === "pop") {
    const boxScale = progress < 0.72 ? 0.85 + 0.2 * (progress / 0.72) : 1.05 - 0.05 * ((progress - 0.72) / 0.28);
    return { opacity: progress, transform: `translateY(0) scale(${boxScale})` };
  }
  if (config.entranceAnimation === "slide") {
    return { opacity: progress, transform: `translateY(${(1 - progress) * 12}px) scale(1)` };
  }
  if (config.entranceAnimation === "flip") {
    return { opacity: progress, transform: `perspective(320px) rotateX(${(1 - progress) * -70}deg) scale(1)` };
  }
  return { opacity: 1, transform: "translateY(0) scale(1)" };
}

function combineTransforms(...parts: string[]) {
  return parts.filter(Boolean).join(" ").trim() || "translateY(0) scale(1)";
}

export default function ViralWordHighlightCaption({
  caption,
  currentTime,
  fps = 30,
  scale = 1,
  transition = false,
  styleConfig,
  canvasSize,
}: Props) {
  const config = normalizeCaptionStyleConfig(styleConfig);
  const words = getRenderableCaptionWords(caption);
  const activeIndex = getActiveWordIndex(words, currentTime);
  const layout = resolveSafeCaptionLayout(config, { canvas: canvasSize, previewScale: scale, words, text: caption.text });
  const fontSize = layout.fontSize;
  const paddingY = Math.max(0, config.paddingY * scale);
  const paddingX = Math.max(0, config.paddingX * scale);

  return (
    <div
      style={buildSafeCaptionPositionStyle(config, layout)}
    >
      <div
        style={{
          maxWidth: "100%",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "baseline",
          columnGap: 0,
          rowGap: "0.08em",
          padding: `${paddingY}px ${paddingX}px`,
          borderRadius: config.borderRadius * scale,
          background: "rgba(0, 0, 0, 0.88)",
          boxShadow: "0 6px 22px rgba(0,0,0,0.58)",
          lineHeight: 1.08,
          textAlign: "center",
          transform: "translateZ(0)",
          overflow: "hidden",
          ...SAFE_CAPTION_TEXT_STYLE,
        }}
      >
        {words.map((word, index) => {
          const isActive = index === activeIndex;
          const isVisible = currentTime >= word.start;
          return (
            <span
              key={`${caption.id}-${index}-${word.start}`}
              style={{
                display: "inline-block",
                marginInlineEnd: index < words.length - 1 ? `calc(0.35em + ${config.wordSpacing || 0}px)` : 0,
                fontFamily: resolveFontFamily(config.fontFamily),
                fontSize,
                fontWeight: config.fontWeight,
                letterSpacing: `${config.letterSpacing || 0}px`,
                wordSpacing: `${config.wordSpacing || 0}px`,
                textTransform: "uppercase",
                color: isActive ? "#22f4b8" : isVisible ? "#ffffff" : "transparent",
                opacity: (() => {
                  const entrance = wordEntranceStyle(word.start, currentTime, fps, config);
                  return currentTime >= word.start ? entrance.opacity : 0;
                })(),
                transform: (() => {
                  const entrance = wordEntranceStyle(word.start, currentTime, fps, config);
                  const ageFrames = wordActivationProgressFrames(word, currentTime, fps);
                  const active = isActive ? activeWordTransform(word, currentTime, fps) : "translateY(0) scale(1)";
                  const motion = wordMotionTransform(ageFrames, config);
                  return combineTransforms(entrance.transform, motion, active);
                })(),
                transition: transition
                  ? "transform 80ms cubic-bezier(0.34, 1.56, 0.64, 1), color 80ms linear"
                  : "none",
                textShadow: isActive
                  ? "0 0 12px rgba(34,244,184,0.75), 0 3px 0 #000, 2px 2px 0 #000, -2px 2px 0 #000"
                  : "0 3px 0 #000, 2px 2px 0 #000, -2px 2px 0 #000",
                willChange: "transform, color",
                visibility: isVisible ? "visible" : "hidden",
                ...SAFE_CAPTION_TEXT_STYLE,
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
