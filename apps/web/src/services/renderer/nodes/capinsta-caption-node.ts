import type { CapinstaTextRenderData } from "@/capinsta/exportRender";
import { renderCapinstaWysiwygExportCaption } from "@/capinsta/export/capinstaWysiwygExportRenderer";
import type { CapinstaCaptionDocumentRecord } from "@/capinsta/types";
import type { EffectPass } from "@/effects/types";
import type { BlendMode, Transform } from "@/rendering";
import { BaseNode } from "./base-node";

declare global {
	interface Window {
		__CAPINSTA_LAST_EXPORT_MANIFEST?: unknown;
	}
}

export interface CapinstaCaptionNodeParams {
	records: CapinstaCaptionDocumentRecord[];
	canvasSize: { width: number; height: number };
	canvasCenter: { x: number; y: number };
	canvasHeight: number;
	blendMode?: BlendMode;
	textBaseline?: CanvasTextBaseline;
}

export interface ResolvedCapinstaCaptionNodeState {
	renderData: CapinstaTextRenderData;
	transform: Transform;
	opacity: number;
	textColor: string;
	backgroundColor: string;
	effectPasses: EffectPass[][];
	activeWordIds: string[];
	timeSeconds: number;
}

export class CapinstaCaptionNode extends BaseNode<
	CapinstaCaptionNodeParams,
	ResolvedCapinstaCaptionNodeState
> {}

export function renderCapinstaCaptionToContext({
	node,
	ctx,
}: {
	node: CapinstaCaptionNode;
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}): void {
	const resolved = node.resolved;
	if (!resolved) {
		return;
	}

	const result = renderCapinstaWysiwygExportCaption({
		ctx,
		renderData: resolved.renderData,
		activeWordIds: resolved.activeWordIds,
		timeSeconds: resolved.timeSeconds,
		canvasSize: node.params.canvasSize,
	});

	if (
		typeof window !== "undefined" &&
		process.env.NEXT_PUBLIC_CAPINSTA_DEBUG === "true"
	) {
		window.__CAPINSTA_LAST_EXPORT_MANIFEST = result.debug.manifest;
		console.info("rendered_capinsta_wysiwyg", result.debug.manifest);
	}
}
