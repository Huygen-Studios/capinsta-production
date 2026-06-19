import { buildDefaultParamValues } from "@/params/registry";
import type { ParamValues } from "@/params";
import { effectsRegistry, resolveEffectPasses } from "@/effects";
import { createCanvasSurface } from "./canvas-utils";
import { gpuRenderer } from "./gpu-renderer";

const PREVIEW_SIZE = 160;

/** Future-ready effect preview renderer with no bundled thumbnail dependency. */
class EffectPreviewService {
	readonly PREVIEW_SIZE = PREVIEW_SIZE;

	renderPreview({
		effectType,
		params,
		targetCanvas,
		uniformDimensions,
	}: {
		effectType: string;
		params: ParamValues;
		targetCanvas: HTMLCanvasElement;
		uniformDimensions?: { width: number; height: number };
	}): void {
		const targetContext = targetCanvas.getContext("2d");
		if (!targetContext) return;

		targetCanvas.width = PREVIEW_SIZE;
		targetCanvas.height = PREVIEW_SIZE;
		const source = this.createTestSource();

		try {
			const definition = effectsRegistry.get(effectType);
			const effectParams =
				Object.keys(params).length > 0
					? params
					: buildDefaultParamValues(definition.params);
			const passes = resolveEffectPasses({
				definition,
				effectParams,
				width: uniformDimensions?.width ?? PREVIEW_SIZE,
				height: uniformDimensions?.height ?? PREVIEW_SIZE,
			});
			const result = gpuRenderer.applyEffect({
				source,
				width: PREVIEW_SIZE,
				height: PREVIEW_SIZE,
				passes,
			});
			targetContext.drawImage(result, 0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
		} catch (error) {
			console.warn("Failed to render effect preview", { effectType, error });
			targetContext.drawImage(source, 0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
		}
	}

	private createTestSource(): OffscreenCanvas {
		const { canvas, context } = createCanvasSurface({
			width: PREVIEW_SIZE,
			height: PREVIEW_SIZE,
		});
		const gradient = context.createLinearGradient(
			0,
			0,
			PREVIEW_SIZE,
			PREVIEW_SIZE,
		);
		gradient.addColorStop(0, "#2563eb");
		gradient.addColorStop(0.5, "#a855f7");
		gradient.addColorStop(1, "#f97316");
		context.fillStyle = gradient;
		context.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
		return canvas;
	}
}

export const effectPreviewService = new EffectPreviewService();
