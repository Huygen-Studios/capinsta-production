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
