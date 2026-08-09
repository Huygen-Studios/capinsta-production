import type { ParamValues } from "@/params";
import { FONT_SIZE_SCALE_REFERENCE } from "@/text/typography";
import type { CapinstaCaptionStyleV1 } from "./styleTypes";
import { resolveCapinstaSafeLayout } from "./layoutSafety";
import { normalizeCapinstaCaptionStyle } from "./styleValidation";
import { getSafeCapinstaPreviewFontSize } from "./styleToPreview";

export interface CapinstaExportStyle {
	textColor: string;
	activeWordColor: string;
	textParams: ParamValues;
	useActiveWordHighlight: boolean;
	canvasFontSizePx: number;
	maxWidthPx: number;
	maxLines: number | "auto";
}

export function styleToExport({
	style: styleInput,
	timingNeedsReview: _timingNeedsReview,
	canvasSize = { width: 1080, height: 1920 },
}: {
	style: unknown;
	timingNeedsReview?: boolean;
	canvasSize?: { width: number; height: number };
}): CapinstaExportStyle {
	const style: CapinstaCaptionStyleV1 = normalizeCapinstaCaptionStyle(styleInput);
	const canvasHeight = Math.max(1, canvasSize.height);
	const canvasWidth = Math.max(1, canvasSize.width);
	const effectiveFontSize = getSafeCapinstaPreviewFontSize({
		style,
		viewportHeight: canvasHeight,
	});
	const maxLines = style.text.maxLines === "auto" ? 2 : style.text.maxLines;
	const estimatedHeightPercent =
		((effectiveFontSize * style.text.lineHeight * maxLines +
			style.background.paddingY * 2) /
			canvasHeight) *
		100 *
		style.layout.scale;
	const layout = resolveCapinstaSafeLayout({
		style,
		estimatedHeightPercent,
	});
	const openCutFontSize =
		effectiveFontSize / (canvasHeight / FONT_SIZE_SCALE_REFERENCE);
	const maxWidthPx = (layout.maxWidthPercent / 100) * canvasWidth;
	return {
		textColor: style.text.color,
		activeWordColor: style.activeWord.color,
		canvasFontSizePx: effectiveFontSize,
		maxWidthPx,
		maxLines: style.text.maxLines,
		useActiveWordHighlight: style.animation.wordEffect !== "none",
		textParams: {
			fontFamily: style.text.fontFamily,
			fontSize: Math.round(openCutFontSize * 1000) / 1000,
			color: style.text.color,
			textAlign: style.text.alignment,
			fontWeight:
				style.text.fontWeight === "normal" ? "normal" : "bold",
			letterSpacing: style.text.letterSpacing,
			lineHeight: style.text.lineHeight,
			"background.enabled": style.background.enabled,
			"background.color": style.background.color,
			"background.cornerRadius": style.background.cornerRadius,
			"background.paddingX": style.background.paddingX,
			"background.paddingY": style.background.paddingY,
			opacity: style.layout.opacity,
			"transform.positionX": (layout.leftPercent / 100) * canvasWidth - canvasWidth / 2,
			"transform.positionY": (layout.topPercent / 100) * canvasHeight - canvasHeight / 2,
			"transform.scaleX": style.layout.scale,
			"transform.scaleY": style.layout.asymmetricScaleEnabled
				? style.layout.scale * (1 - style.layout.asymmetricScaleStrength)
				: style.layout.scale,
			"transform.rotate": style.layout.rotation,
		},
	};
}
