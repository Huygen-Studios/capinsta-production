import type { MediaAsset } from "@/media/types";
import {
	evaluateTemplateScene,
	findTemplateDefinition,
	ratioValue,
	type TemplateMediaFit,
} from "@/templates";
import type {
	MotionTemplateElement,
	MotionTemplateSlotBinding,
} from "@/timeline";
import { TICKS_PER_SECOND } from "@/wasm";
import { createCanvasSurface } from "../canvas-utils";
import { loadImageSource } from "./image-node";
import { BaseNode } from "./base-node";
import { videoCache } from "@/services/video-cache/service";
import { resolveTemplateVideoSourceTimeSeconds } from "@/templates/media-timing";

export interface MotionTemplateNodeParams {
	element: MotionTemplateElement;
	mediaAssets: MediaAsset[];
	duration: number;
	timeOffset: number;
	isPreview?: boolean;
}

export interface ResolvedMotionTemplateNodeState {
	source: OffscreenCanvas;
	width: number;
	height: number;
	localTime: number;
	contentHash: string;
}

type DrawableSource = {
	source: CanvasImageSource;
	width: number;
	height: number;
};

export class MotionTemplateNode extends BaseNode<
	MotionTemplateNodeParams,
	ResolvedMotionTemplateNodeState
> {}

export async function resolveMotionTemplateSource({
	node,
	width,
	height,
	time,
}: {
	node: MotionTemplateNode;
	width: number;
	height: number;
	time: number;
}): Promise<ResolvedMotionTemplateNodeState | null> {
	const { element } = node.params;
	const clipTime = time - node.params.timeOffset;
	if (clipTime < 0 || clipTime >= node.params.duration) return null;
	const localTimeSeconds = clipTime / TICKS_PER_SECOND;
	const definition = findTemplateDefinition({ templateId: element.templateId });
	if (!definition) return null;

	const { canvas, context } = createCanvasSurface({ width, height });
	const frame = templateFrameRect({
		width,
		height,
		ratio: ratioValue({ value: element.templateParams.frameRatio }),
	});
	const background =
		typeof element.templateParams.background === "string"
			? element.templateParams.background
			: "#101014";
	context.fillStyle = background;
	context.fillRect(frame.x, frame.y, frame.width, frame.height);

	const layers = evaluateTemplateScene({
		element,
		localTime: localTimeSeconds,
	});
	const mediaById = new Map(
		node.params.mediaAssets.map((asset) => [asset.id, asset]),
	);

	for (const layer of layers) {
		if (layer.opacity <= 0) continue;
		const binding = element.slotBindings[layer.slotId];
		const asset = binding ? mediaById.get(binding.mediaId) : undefined;
		const source =
			asset && binding
				? await resolveSlotSource({
						asset,
						binding,
						localTime: localTimeSeconds,
						isPreview: node.params.isPreview ?? false,
					})
				: null;
		drawCard({
			ctx: context,
			frame,
			layer,
			source,
			binding,
			params: element.templateParams,
		});
	}

	return {
		source: canvas,
		width,
		height,
		localTime: localTimeSeconds,
		contentHash: `motion-template:${element.id}:${JSON.stringify({
			templateId: element.templateId,
			version: element.templateVersion,
			params: element.templateParams,
			bindings: element.slotBindings,
			slotOrder: element.slotOrder,
			time: Number(localTimeSeconds.toFixed(3)),
			width,
			height,
		})}`,
	};
}

async function resolveSlotSource({
	asset,
	binding,
	localTime,
	isPreview,
}: {
	asset: MediaAsset;
	binding: MotionTemplateSlotBinding;
	localTime: number;
	isPreview: boolean;
}): Promise<DrawableSource | null> {
	if (!asset.url) return null;
	if (asset.type === "image") {
		const image = await loadImageSource({
			url: asset.url,
			maxSourceSize: isPreview ? 2048 : undefined,
		});
		return { source: image.source, width: image.width, height: image.height };
	}
	if (asset.type === "video") {
		const sourceTimeSeconds = resolveTemplateVideoSourceTimeSeconds({
			binding,
			assetDurationSeconds: asset.duration,
			localTimeSeconds: localTime,
		});
		if (sourceTimeSeconds === null) return null;
		const frame = await videoCache.getFrameAt({
			mediaId: asset.id,
			file: asset.file,
			time: sourceTimeSeconds,
		});
		if (!frame) return null;
		return {
			source: frame.canvas,
			width: frame.canvas.width,
			height: frame.canvas.height,
		};
	}
	return null;
}

function drawCard({
	ctx,
	frame,
	layer,
	source,
	binding,
	params,
}: {
	ctx: OffscreenCanvasRenderingContext2D;
	frame: TemplateFrameRect;
	layer: ReturnType<typeof evaluateTemplateScene>[number];
	source: DrawableSource | null;
	binding: MotionTemplateSlotBinding | null;
	params: Record<string, unknown>;
}) {
	const padding = readNumber({
		value: params.padding,
		fallback: 0.06,
		min: 0,
		max: 0.3,
	});
	const content = insetRect({ rect: frame, inset: padding });
	const cardWidth = Math.max(1, content.width * layer.scale);
	const cardHeight = cardWidth / Math.max(0.1, layer.cardRatio);
	const x = content.x + layer.x * content.width;
	const y = content.y + layer.y * content.height;
	const cornerRadius =
		readNumber({
			value: params.cornerRadius,
			fallback: 0.04,
			min: 0,
			max: 0.5,
		}) * Math.min(cardWidth, cardHeight);

	ctx.save();
	ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
	ctx.translate(x, y);
	ctx.rotate((layer.rotation * Math.PI) / 180);
	if (params.shadowEnabled === true) {
		ctx.shadowColor = shadowColor({
			color:
				typeof params.shadowColor === "string" ? params.shadowColor : "#000000",
			opacity: readNumber({
				value: params.shadowOpacity,
				fallback: 0.3,
				min: 0,
				max: 1,
			}),
		});
		ctx.shadowBlur = readNumber({
			value: params.shadowBlur,
			fallback: 12,
			min: 0,
			max: 64,
		});
		ctx.shadowOffsetX = readNumber({
			value: params.shadowOffsetX,
			fallback: 0,
			min: -64,
			max: 64,
		});
		ctx.shadowOffsetY = readNumber({
			value: params.shadowOffsetY,
			fallback: 12,
			min: -64,
			max: 64,
		});
	}
	roundedRect({
		ctx,
		x: -cardWidth / 2,
		y: -cardHeight / 2,
		width: cardWidth,
		height: cardHeight,
		radius: cornerRadius,
	});
	ctx.fillStyle = "#2d2d34";
	ctx.fill();
	ctx.clip();
	ctx.shadowColor = "transparent";
	if (source) {
		drawMedia({
			ctx,
			source,
			width: cardWidth,
			height: cardHeight,
			fit: binding?.fit ?? "cover",
			crop: binding?.crop,
		});
	} else {
		ctx.fillStyle = "#565762";
		ctx.fillRect(-cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight);
	}
	ctx.restore();
}

type TemplateFrameRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

function templateFrameRect({
	width,
	height,
	ratio,
}: {
	width: number;
	height: number;
	ratio: number;
}): TemplateFrameRect {
	const safeRatio = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
	const canvasRatio = width / height;
	const frameWidth = canvasRatio > safeRatio ? height * safeRatio : width;
	const frameHeight = canvasRatio > safeRatio ? height : width / safeRatio;
	return {
		x: (width - frameWidth) / 2,
		y: (height - frameHeight) / 2,
		width: frameWidth,
		height: frameHeight,
	};
}

function insetRect({
	rect,
	inset,
}: {
	rect: TemplateFrameRect;
	inset: number;
}): TemplateFrameRect {
	const insetX = rect.width * inset;
	const insetY = rect.height * inset;
	const width = Math.max(1, rect.width - insetX * 2);
	const height = Math.max(1, rect.height - insetY * 2);
	return {
		x: rect.x + insetX,
		y: rect.y + insetY,
		width,
		height,
	};
}

function drawMedia({
	ctx,
	source,
	width,
	height,
	fit,
	crop,
}: {
	ctx: OffscreenCanvasRenderingContext2D;
	source: DrawableSource;
	width: number;
	height: number;
	fit: TemplateMediaFit;
	crop?: MotionTemplateSlotBinding["crop"];
}) {
	const sourceRatio = source.width / source.height;
	const targetRatio = width / height;
	let drawWidth = width;
	let drawHeight = height;
	if (fit === "cover") {
		if (sourceRatio > targetRatio) {
			drawHeight = height;
			drawWidth = height * sourceRatio;
		} else {
			drawWidth = width;
			drawHeight = width / sourceRatio;
		}
	} else if (fit === "contain") {
		if (sourceRatio > targetRatio) {
			drawWidth = width;
			drawHeight = width / sourceRatio;
		} else {
			drawHeight = height;
			drawWidth = height * sourceRatio;
		}
	}
	const zoom = crop?.scale ?? 1;
	drawWidth *= zoom;
	drawHeight *= zoom;
	const offsetX = (crop?.x ?? 0) * width * 0.5;
	const offsetY = (crop?.y ?? 0) * height * 0.5;
	ctx.drawImage(
		source.source,
		-width / 2 + (width - drawWidth) / 2 + offsetX,
		-height / 2 + (height - drawHeight) / 2 + offsetY,
		drawWidth,
		drawHeight,
	);
}

function roundedRect({
	ctx,
	x,
	y,
	width,
	height,
	radius,
}: {
	ctx: OffscreenCanvasRenderingContext2D;
	x: number;
	y: number;
	width: number;
	height: number;
	radius: number;
}) {
	const r = Math.min(radius, width / 2, height / 2);
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + width - r, y);
	ctx.quadraticCurveTo(x + width, y, x + width, y + r);
	ctx.lineTo(x + width, y + height - r);
	ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
	ctx.lineTo(x + r, y + height);
	ctx.quadraticCurveTo(x, y + height, x, y + height - r);
	ctx.lineTo(x, y + r);
	ctx.quadraticCurveTo(x, y, x + r, y);
	ctx.closePath();
}

function readNumber({
	value,
	fallback,
	min,
	max,
}: {
	value: unknown;
	fallback: number;
	min: number;
	max: number;
}) {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(min, Math.min(max, value))
		: fallback;
}

function shadowColor({ color, opacity }: { color: string; opacity: number }) {
	const trimmed = color.trim();
	if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
		const r = Number.parseInt(trimmed.slice(1, 3), 16);
		const g = Number.parseInt(trimmed.slice(3, 5), 16);
		const b = Number.parseInt(trimmed.slice(5, 7), 16);
		return `rgba(${r}, ${g}, ${b}, ${opacity})`;
	}
	return trimmed;
}
