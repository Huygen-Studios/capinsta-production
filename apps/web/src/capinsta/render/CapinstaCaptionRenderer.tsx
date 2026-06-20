"use client";

import { memo, useMemo } from "react";
import OriginalCaptionRenderer from "../original/CaptionRenderer";
import type {
	NeutralCaptionClip,
	NeutralCaptionDocument,
} from "../types";
import { resolveCapinstaClipStyle } from "../styles/styleMigration";
import {
	toOriginalCaption,
	toOriginalCaptionStyleConfig,
} from "../originalAdapter";
import type { CapinstaRenderModel } from "./capinstaRenderModel";

export type CapinstaRenderMode = "preview" | "export";

export function resolveCaptionTransition({
	renderMode,
	isPlaying,
}: {
	renderMode: CapinstaRenderMode;
	isPlaying: boolean;
}): boolean {
	return renderMode === "export" ? false : !isPlaying;
}

export const CapinstaCaptionRenderer = memo(function CapinstaCaptionRenderer({
	renderModel,
	document,
	clip,
	timeSeconds,
	isPlaying,
	renderMode = "preview",
	fps,
	viewport,
}: {
	renderModel?: CapinstaRenderModel;
	document?: NeutralCaptionDocument;
	clip?: NeutralCaptionClip;
	activeWordIds: string[];
	timeSeconds: number;
	isPlaying?: boolean;
	renderMode?: CapinstaRenderMode;
	fps?: number;
	viewport?: { width: number; height: number };
}) {
	const style = useMemo(
		() =>
			renderModel?.captionStyle ??
			(document && clip
				? resolveCapinstaClipStyle({
						document,
						clip,
					})
				: null),
		[renderModel?.captionStyle, document, clip],
	);
	const originalStyleConfig = useMemo(
		() =>
			renderModel?.styleConfig ??
			(style ? toOriginalCaptionStyleConfig({ style }) : null),
		[renderModel?.styleConfig, style],
	);
	const originalCaption = useMemo(
		() =>
			renderModel
				? renderModel.originalCaption
				: document && clip && style
					? toOriginalCaption({ document, clip, style })
					: null,
		[renderModel, document, clip, style],
	);
	const captions = useMemo(
		() => (originalCaption ? [originalCaption] : []),
		[originalCaption],
	);
	const canvasSize = useMemo(
		() =>
			viewport
				? { width: viewport.width, height: viewport.height }
				: undefined,
		[viewport],
	);

	if (!originalStyleConfig || captions.length === 0) return null;

	return (
		<OriginalCaptionRenderer
			captions={captions}
			currentTime={timeSeconds}
			fps={renderMode === "export" ? Math.max(1, fps ?? 30) : isPlaying ? 12 : 30}
			scale={1}
			transition={resolveCaptionTransition({
				renderMode,
				isPlaying: Boolean(isPlaying),
			})}
			styleConfig={originalStyleConfig}
			canvasSize={canvasSize}
		/>
	);
});
