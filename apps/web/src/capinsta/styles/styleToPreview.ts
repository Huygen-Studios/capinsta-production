/* eslint-disable opencut/prefer-object-params -- Tiny local color helpers are easier to scan with primitive arguments. */
import type { CSSProperties } from "react";
import { CAPINSTA_FONT_STACKS } from "./defaultStyle";
import { resolveCapinstaSafeLayout } from "./layoutSafety";
import { normalizeCapinstaCaptionStyle } from "./styleValidation";
import type { CapinstaCaptionStyleV1 } from "./styleTypes";

export interface CapinstaPreviewStyle {
	containerStyle: CSSProperties;
	textStyle: CSSProperties;
	wordStyle: CSSProperties;
	activeWordStyle: CSSProperties;
	backgroundStyle: CSSProperties;
	effectiveFontSize: number;
}

function rgba(color: string, opacity: number): string {
	if (color.startsWith("rgb")) return color;
	const hex = color.replace("#", "");
	const full = hex.length === 3 ? hex.split("").map((c) => `${c}${c}`).join("") : hex;
	const value = Number.parseInt(full.slice(0, 6), 16);
	const r = (value >> 16) & 255;
	const g = (value >> 8) & 255;
	const b = value & 255;
	return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function shadow({
	color,
	opacity,
	blur,
	distance,
	angle,
}: {
	color: string;
	opacity: number;
	blur: number;
	distance: number;
	angle: number;
}): string {
	const radians = (angle * Math.PI) / 180;
	const x = Math.cos(radians) * distance;
	const y = Math.sin(radians) * distance;
	return `${x.toFixed(1)}px ${y.toFixed(1)}px ${blur}px ${rgba(color, opacity)}`;
}

export function getSafeCapinstaPreviewFontSize({
	style,
	viewportHeight,
}: {
	style: CapinstaCaptionStyleV1;
	viewportHeight?: number;
}): number {
	if (!viewportHeight || viewportHeight <= 0) {
		return Math.min(style.text.fontSize, 72);
	}
	const designScale = viewportHeight / 1080;
	const maxLines = style.text.maxLines === "auto" ? 2 : style.text.maxLines;
	const maxLineHeight = viewportHeight * (maxLines === 1 ? 0.18 : 0.14);
	const maxBlockHeight = (viewportHeight * 0.3) / Math.max(1, maxLines);
	const scaled = style.text.fontSize * designScale;
	const fontSize = Math.max(
		11,
		Math.min(scaled, maxLineHeight, maxBlockHeight, viewportHeight * 0.2),
	);
	return Math.round(fontSize * 100) / 100;
}

export function styleToPreview({
	style: styleInput,
	viewport,
}: {
	style: unknown;
	viewport?: { width: number; height: number };
}): CapinstaPreviewStyle {
	const style: CapinstaCaptionStyleV1 = normalizeCapinstaCaptionStyle(styleInput);
	const effectiveFontSize = getSafeCapinstaPreviewFontSize({
		style,
		viewportHeight: viewport?.height,
	});
	const lineCount = style.text.maxLines === "auto" ? 2 : style.text.maxLines;
	const estimatedHeightPercent = viewport?.height
		? ((effectiveFontSize * style.text.lineHeight * lineCount +
				style.background.paddingY * 2) /
				viewport.height) *
			100 *
			style.layout.scale
		: 0;
	const layout = resolveCapinstaSafeLayout({
		style,
		estimatedHeightPercent,
	});
	const fontFamily = CAPINSTA_FONT_STACKS[style.text.fontFamily] ?? style.text.fontFamily;
	const stroke =
		style.outline.width > 0
			? `${style.outline.width}px ${style.outline.color}`
			: undefined;
	return {
		containerStyle: {
			position: "absolute",
			left: `${layout.leftPercent}%`,
			top: `${layout.topPercent}%`,
			width: `${layout.maxWidthPercent}%`,
			transform: layout.transform,
			opacity: layout.opacity,
			textAlign: layout.textAlign,
			pointerEvents: "none",
		},
		textStyle: {
			color: rgba(style.text.color, style.text.opacity),
			fontFamily,
			fontWeight: style.text.fontWeight,
			fontSize: `${effectiveFontSize}px`,
			lineHeight: style.text.lineHeight,
			textTransform: style.text.textTransform,
			letterSpacing: `${style.text.letterSpacing}px`,
			textShadow: style.shadow.enabled
				? shadow(style.shadow)
				: undefined,
			WebkitTextStroke: stroke,
			WebkitLineClamp: style.text.maxLines === "auto" ? undefined : style.text.maxLines,
			display: style.text.maxLines === "auto" ? "inline-block" : "-webkit-box",
			WebkitBoxOrient: style.text.maxLines === "auto" ? undefined : "vertical",
			overflow: style.text.maxLines === "auto" ? undefined : "hidden",
			overflowWrap: "anywhere",
			wordBreak: "normal",
		},
		wordStyle: {
			display: "inline-block",
			whiteSpace: "pre-wrap",
			transition: "color 80ms linear, transform 80ms linear",
		},
		activeWordStyle: {
			color: style.activeWord.color,
			transform: `scale(${style.activeWord.scale})`,
			textShadow: style.activeWord.glow
				? `0 0 16px ${rgba(style.activeWord.color, 0.7)}`
				: undefined,
			backgroundColor: style.activeWord.backgroundEnabled
				? rgba(style.activeWord.backgroundColor, style.activeWord.backgroundOpacity)
				: undefined,
			padding: style.activeWord.backgroundEnabled
				? `${style.activeWord.backgroundPaddingY}px ${style.activeWord.backgroundPaddingX}px`
				: undefined,
			borderRadius: style.activeWord.backgroundEnabled
				? `${style.activeWord.backgroundCornerRadius}px`
				: undefined,
		},
		backgroundStyle: {
			width:
				style.background.enabled && style.background.fit === "fill"
					? "100%"
					: undefined,
			backgroundColor: style.background.enabled
				? rgba(style.background.color, style.background.opacity)
				: undefined,
			padding: style.background.enabled
				? `${style.background.paddingY}px ${style.background.paddingX}px`
				: undefined,
			borderRadius: style.background.enabled
				? `${style.background.cornerRadius}px`
				: undefined,
			border:
				style.background.enabled && style.background.borderEnabled
					? `${style.background.borderWidth}px solid ${style.background.borderColor}`
					: undefined,
			boxShadow:
				style.background.enabled && style.background.shadowEnabled
					? shadow({
							color: style.background.shadowColor,
							opacity: style.background.shadowOpacity,
							blur: style.background.shadowBlur,
							distance: style.background.shadowDistance,
							angle: style.background.shadowAngle,
						})
					: undefined,
		},
		effectiveFontSize,
	};
}
