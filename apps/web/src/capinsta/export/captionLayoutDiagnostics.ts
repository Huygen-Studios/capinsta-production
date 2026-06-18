import { resolveCapinstaSafeLayout, type ResolvedCapinstaSafeLayout } from "@/capinsta/styles/layoutSafety";
import { normalizeCapinstaCaptionStyle } from "@/capinsta/styles/styleValidation";

export interface ResolvedCapinstaCaptionLayout extends ResolvedCapinstaSafeLayout {
	canvasWidth: number;
	canvasHeight: number;
}

function hashString(input: string): string {
	let hash = 2166136261;
	for (let index = 0; index < input.length; index += 1) {
		hash ^= input.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

export function resolveCapinstaCaptionLayout(
	styleInput: unknown,
	canvasWidth: number,
	canvasHeight: number,
): ResolvedCapinstaCaptionLayout {
	const style = normalizeCapinstaCaptionStyle(styleInput);
	const maxLines = style.text.maxLines === "auto" ? 2 : style.text.maxLines;
	const estimatedHeightPercent =
		((style.text.fontSize * style.text.lineHeight * maxLines + style.background.paddingY * 2) /
			Math.max(1, canvasHeight)) *
		100 *
		style.layout.scale;
	return {
		...resolveCapinstaSafeLayout({ style, estimatedHeightPercent }),
		canvasWidth,
		canvasHeight,
	};
}

export function summarizeCaptionLayout(layout: ResolvedCapinstaCaptionLayout): Record<string, unknown> {
	return {
		leftPercent: Number(layout.leftPercent.toFixed(3)),
		topPercent: Number(layout.topPercent.toFixed(3)),
		maxWidthPercent: Number(layout.maxWidthPercent.toFixed(3)),
		transform: layout.transform,
		opacity: Number(layout.opacity.toFixed(3)),
		textAlign: layout.textAlign,
		canvasWidth: layout.canvasWidth,
		canvasHeight: layout.canvasHeight,
	};
}

export function computeCaptionLayoutHash(layout: ResolvedCapinstaCaptionLayout): string {
	return hashString(JSON.stringify(summarizeCaptionLayout(layout)));
}
