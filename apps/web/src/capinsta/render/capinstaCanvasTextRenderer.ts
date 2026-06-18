/**
 * @deprecated This module is completely unused. Zero imports exist anywhere in the
 * codebase. Caption rendering for export is handled by `capinstaWysiwygExportRenderer.ts`
 * via `CapinstaCaptionNode`; preview rendering is handled by `CapinstaCaptionRenderer.tsx`
 * (React DOM) via `CapinstaActiveCaptionOverlay`. This file should NOT be imported.
 * Planned for removal in a future cleanup pass.
 */
import type { CapinstaCaptionStyleV1 } from "../styles/styleTypes";

export interface CapinstaCanvasTextRenderOptions {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	text: string;
	x: number;
	y: number;
	style: CapinstaCaptionStyleV1;
}

export function drawCapinstaCanvasText({
	ctx,
	text,
	x,
	y,
	style,
}: CapinstaCanvasTextRenderOptions): void {
	ctx.save();
	ctx.globalAlpha = style.text.opacity * style.layout.opacity;
	ctx.font = `${style.text.fontWeight} ${style.text.fontSize}px ${style.text.fontFamily}, sans-serif`;
	ctx.textAlign = style.text.alignment;
	ctx.textBaseline = "middle";
	if (style.outline.width > 0) {
		ctx.strokeStyle = style.outline.color;
		ctx.lineWidth = style.outline.width;
		ctx.lineJoin = "round";
		ctx.strokeText(text, x, y);
	}
	ctx.fillStyle = style.text.color;
	ctx.fillText(text, x, y);
	ctx.restore();
}
