import { BaseNode } from "./base-node";
import type { TextElement } from "@/timeline";
import type { EffectPass } from "@/effects/types";
import type { BlendMode, Transform } from "@/rendering";
import {
	drawMeasuredTextLayout,
	drawMeasuredTextLayoutWithWordHighlight,
} from "@/text/primitives";
import type { MeasuredTextElement } from "@/text/measure-element";
import type { CapinstaTextRenderData } from "@/capinsta/exportRender";

export type TextNodeParams = TextElement & {
	transform: Transform;
	opacity: number;
	blendMode?: BlendMode;
	canvasCenter: { x: number; y: number };
	canvasHeight: number;
	textBaseline?: CanvasTextBaseline;
	capinstaExport?: CapinstaTextRenderData;
};

export interface ResolvedTextNodeState {
	transform: Transform;
	opacity: number;
	textColor: string;
	backgroundColor: string;
	effectPasses: EffectPass[][];
	measuredText: MeasuredTextElement;
	activeCapinstaWordIds?: string[];
}

export class TextNode extends BaseNode<TextNodeParams, ResolvedTextNodeState> {}

export function renderTextToContext({
	node,
	ctx,
}: {
	node: TextNode;
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}): void {
	const resolved = node.resolved;
	if (!resolved) {
		return;
	}

	const x = resolved.transform.position.x + node.params.canvasCenter.x;
	const y = resolved.transform.position.y + node.params.canvasCenter.y;
	const baseline = node.params.textBaseline ?? "middle";

	ctx.save();
	ctx.translate(x, y);
	ctx.scale(resolved.transform.scaleX, resolved.transform.scaleY);
	if (resolved.transform.rotate) {
		ctx.rotate((resolved.transform.rotate * Math.PI) / 180);
	}

	if (node.params.capinstaExport) {
		// Suppress legacy text rendering for Capinsta captions
		// They are rendered either by CapinstaCaptionOverlay (React) or CapinstaCaptionNode (Canvas)
		return;
	}

	if (node.params.capinstaExport && resolved.activeCapinstaWordIds?.length) {
		const activeWordIndexes = new Set(
			node.params.capinstaExport.wordIds
				.map((wordId, index) =>
					resolved.activeCapinstaWordIds?.includes(wordId) ? index : -1,
				)
				.filter((index) => index >= 0),
		);
		drawMeasuredTextLayoutWithWordHighlight({
			ctx,
			layout: resolved.measuredText,
			textColor: resolved.textColor,
			activeWordColor: node.params.capinstaExport.activeWordColor,
			activeWordIndexes,
			background: resolved.measuredText.resolvedBackground,
			backgroundColor: resolved.backgroundColor,
			textBaseline: baseline,
		});
	} else {
		drawMeasuredTextLayout({
			ctx,
			layout: resolved.measuredText,
			textColor: resolved.textColor,
			background: resolved.measuredText.resolvedBackground,
			backgroundColor: resolved.backgroundColor,
			textBaseline: baseline,
		});
	}

	ctx.restore();
}
