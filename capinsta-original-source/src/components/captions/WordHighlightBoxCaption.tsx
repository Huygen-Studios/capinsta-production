"use client";

import React from "react";
import { Caption, CaptionStyleConfig } from "@/lib/types";
import {
  CaptionCanvasSize,
  SAFE_CAPTION_TEXT_STYLE,
  buildSafeCaptionPositionStyle,
  resolveSafeCaptionLayout,
} from "@/lib/captionLayoutSafety";
import {
  backgroundRgba,
  colorToRgba,
  directionalShadow,
  normalizeCaptionStyleConfig,
  resolveFontFamily,
} from "@/lib/captionStyleConfig";
import { getActiveWordIndex, getRenderableCaptionWords, getWordDisplayText, wordActivationProgressFrames } from "@/lib/captionUtils";

interface Props {
  caption: Caption;
  currentTime: number;
  styleConfig?: Partial<CaptionStyleConfig> | null;
  fps?: number;
  scale?: number;
  transition?: boolean;
  canvasSize?: CaptionCanvasSize;
}

function interpolate(input: number, inMin: number, inMax: number, outMin: number, outMax: number) {
  const t = Math.max(0, Math.min(1, (input - inMin) / (inMax - inMin)));
  return outMin + (outMax - outMin) * t;
}

function readableTextColor(backgroundColor: string) {
  const hex = backgroundColor.replace("#", "");
  const fullHex = hex.length === 3 ? hex.split("").map((value) => value + value).join("") : hex;
  if (fullHex.length !== 6) return "#111111";

  const red = parseInt(fullHex.slice(0, 2), 16);
  const green = parseInt(fullHex.slice(2, 4), 16);
  const blue = parseInt(fullHex.slice(4, 6), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.58 ? "#111111" : "#FFFFFF";
}

function activeWordTransform(
  ageFrames: number,
  config: CaptionStyleConfig
) {
  if (config.animationType === "none" || config.animationStrength <= 0) {
    return "translateY(0) scale(1)";
  }

  const speed = Math.max(0.4, config.animationSpeed);
  const smoothness = Math.max(0, Math.min(1, config.animationSmoothness));
  const peakFrame = Math.max(2, (3 + smoothness * 2) / speed);
  const settleFrame = Math.max(peakFrame + 2, (8 + smoothness * 4) / speed);
  const maxScale = 1 + (config.activeWordScale - 1) * config.animationStrength;
  const lift = config.animationType === "bounce" ? -4 * config.animationStrength : -2.5 * config.animationStrength;

  if (ageFrames <= peakFrame) {
    const startScale = interpolate(config.animationStrength, 0, 1.4, 1, 0.98);
    const scale = interpolate(ageFrames, 0, peakFrame, startScale, maxScale);
    const y = interpolate(ageFrames, 0, peakFrame, 5 * config.animationStrength, lift);
    const squash = config.asymmetricScaleEnabled ? Math.sin(Math.min(1, ageFrames / peakFrame) * Math.PI) * (config.asymmetricScaleStrength || 0) : 0;
    return `translateY(${y}px) scale(${scale}) scaleX(${1 + squash * 0.08}) scaleY(${1 - squash * 0.045})`;
  }

  if (ageFrames <= settleFrame) {
    const settle = config.animationType === "bounce" && ageFrames < settleFrame - 2 ? 0.98 : 1;
    const scale = interpolate(ageFrames, peakFrame, settleFrame, maxScale, settle);
    const y = interpolate(ageFrames, peakFrame, settleFrame, lift, 0);
    const squash = config.asymmetricScaleEnabled ? Math.sin(Math.max(0, 1 - (ageFrames - peakFrame) / Math.max(0.001, settleFrame - peakFrame)) * Math.PI) * (config.asymmetricScaleStrength || 0) : 0;
    return `translateY(${y}px) scale(${scale}) scaleX(${1 + squash * 0.08}) scaleY(${1 - squash * 0.045})`;
  }

  return "translateY(0) scale(1)";
}

function entranceTransform(currentTime: number, captionStart: number, config: CaptionStyleConfig, fps: number) {
  const ageFrames = Math.max(0, (currentTime - captionStart) * fps);
  const speed = Math.max(0.4, config.animationSpeed);
  const duration = Math.max(2, 8 / speed);
  const progress = Math.max(0, Math.min(1, ageFrames / duration));

  if (config.entranceAnimation === "fade") {
    return { opacity: progress, transform: "translate(-50%, -50%) scale(1)" };
  }
  if (config.entranceAnimation === "flip") {
    return { opacity: progress, transform: `translate(-50%, -50%) perspective(420px) rotateX(${(1 - progress) * -70}deg) scale(1)` };
  }
  if (config.entranceAnimation === "pop") {
    const boxScale = progress < 0.72 ? interpolate(progress, 0, 0.72, 0.85, 1.05) : interpolate(progress, 0.72, 1, 1.05, 1);
    return { opacity: progress, transform: `translate(-50%, -50%) scale(${boxScale})` };
  }
  if (config.entranceAnimation === "slide") {
    const y = interpolate(progress, 0, 1, 12, 0);
    return { opacity: progress, transform: `translate(-50%, calc(-50% + ${y}px)) scale(1)` };
  }

  return { opacity: 1, transform: "translate(-50%, -50%) scale(1)" };
}

export default function WordHighlightBoxCaption({
  caption,
  currentTime,
  styleConfig,
  fps = 30,
  scale = 1,
  transition = false,
  canvasSize,
}: Props) {
  const config = normalizeCaptionStyleConfig(styleConfig);
  const words = getRenderableCaptionWords(caption);
  const layout = resolveSafeCaptionLayout(config, { canvas: canvasSize, previewScale: scale, words, text: caption.text });
  const fontSize = layout.fontSize;
  const maxLines = config.maxLines === "auto" ? layout.lineClamp : config.maxLines;

  const activeIndex = getActiveWordIndex(words, currentTime);
  const entrance = entranceTransform(currentTime, caption.start, config, fps);

  const justifyContent =
    config.alignment === "left" ? "flex-start" : config.alignment === "right" ? "flex-end" : "center";
  const textAlign = config.alignment;
  const boxShadow = [
    config.backgroundShadow
      ? directionalShadow(
          config.backgroundShadowColor,
          config.backgroundShadowOpacity,
          config.backgroundShadowDistance,
          config.backgroundShadowBlur,
          config.backgroundShadowAngle
        ) || "0 8px 28px rgba(0,0,0,0.42)"
      : "",
    config.textShadowEnabled ? "0 2px 2px rgba(0,0,0,0.45)" : "",
  ].filter(Boolean).join(", ");

  return (
    <div
      data-caption-theme="word_highlight_box"
      style={{
        ...buildSafeCaptionPositionStyle(config, layout, entrance.transform),
        opacity: entrance.opacity * config.opacity,
      }}
    >
      <div
        style={{
          display: "inline-flex",
          width: config.backgroundFit === "fill" ? "100%" : undefined,
          flexWrap: maxLines === 1 ? "nowrap" : "wrap",
          justifyContent,
          alignItems: "center",
          maxWidth: "100%",
          maxHeight: `${Math.ceil(fontSize * config.lineHeight * maxLines + Math.max(0, config.paddingY * scale) * 2)}px`,
          columnGap: 0,
          rowGap: "0.08em",
          padding: `${Math.max(0, config.paddingY * scale)}px ${Math.max(0, config.paddingX * scale)}px`,
          borderRadius: Math.max(0, config.borderRadius * scale),
          background: config.backgroundEnabled ? backgroundRgba(config) : "transparent",
          border: config.backgroundBorderEnabled
            ? `${config.backgroundBorderWidth}px solid ${config.backgroundBorderColor}`
            : "none",
          boxShadow,
          lineHeight: config.lineHeight,
          textAlign,
          transform: "translateZ(0)",
          overflow: "hidden",
          ...SAFE_CAPTION_TEXT_STYLE,
        }}
      >
        {words.map((word, index) => {
          const isActive = index === activeIndex;
          const isVisible = currentTime >= word.start;
          const isHighlightEffect = config.wordEffect === "highlight";
          const isPaintEffect = config.wordEffect === "paint";
          const hasActiveColor =
            isActive &&
            (config.wordEffect === "bounce" || config.wordEffect === "pop");
          const hasActiveMotion =
            isActive &&
            (config.wordEffect === "highlight" || config.wordEffect === "bounce" || config.wordEffect === "pop");
          const highlightBackgroundColor = config.activeWordBackgroundColor;
          const hasActiveBackground = isVisible && isActive && (isHighlightEffect || config.activeWordBackgroundEnabled);
          const ageFrames = wordActivationProgressFrames(word, currentTime, fps);
          const glow = config.activeWordGlow && isActive
            ? `0 0 ${Math.round(14 * config.animationStrength)}px ${config.activeWordColor}`
            : "";
          const textShadow = config.textShadowEnabled
            ? [
                directionalShadow(
                  config.textShadowColor,
                  config.textShadowOpacity,
                  config.textShadowDistance,
                  config.textShadowBlur,
                  config.textShadowAngle
                ),
                glow,
              ].filter(Boolean).join(", ")
            : glow || undefined;

          return (
            <span
              key={`${caption.id}-${index}-${word.start}`}
              data-active-word={isActive ? "true" : "false"}
              style={{
                display: "inline-block",
                marginInlineEnd: index < words.length - 1 ? "0.32em" : 0,
                fontFamily: resolveFontFamily(config.fontFamily),
                fontSize,
                  fontWeight: config.fontWeight,
                  letterSpacing: `${config.letterSpacing}px`,
                  lineHeight: config.lineHeight,
                  textTransform: config.textTransform,
                  color: hasActiveBackground
                    ? readableTextColor(highlightBackgroundColor)
                    : isPaintEffect && isVisible
                    ? config.activeWordColor
                    : hasActiveColor
                    ? config.activeWordColor
                    : isVisible
                    ? config.textColor
                    : "transparent",
                  background: hasActiveBackground
                    ? colorToRgba(highlightBackgroundColor, config.activeWordBackgroundOpacity)
                    : "transparent",
                borderRadius: config.activeWordBackgroundBorderRadius * scale,
                padding: hasActiveBackground
                  ? `${config.activeWordBackgroundPaddingY * scale}px ${config.activeWordBackgroundPaddingX * scale}px`
                  : 0,
                transform: !isVisible
                  ? "translateY(6px) scale(0.98)"
                  : hasActiveMotion
                  ? activeWordTransform(ageFrames, config)
                  : "translateY(0) scale(1)",
                transition: transition
                  ? "transform 120ms cubic-bezier(0.45, 0, 0.2, 1), color 100ms linear, background 100ms linear, text-shadow 100ms linear"
                  : "none",
                textShadow: isVisible ? textShadow : undefined,
                WebkitTextStroke: config.textStrokeEnabled
                  ? `${config.textStrokeWidth * scale}px ${config.textStrokeColor}`
                  : undefined,
                willChange: "transform, color",
                visibility: isVisible ? "visible" : "hidden",
                opacity: isVisible ? 1 : 0,
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
