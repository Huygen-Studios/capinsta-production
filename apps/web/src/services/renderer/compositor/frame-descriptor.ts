import { drawCssBackground } from "@/gradients";
import { getMaskDefinition } from "@/masks";
import { incrementCounter } from "@/diagnostics/render-perf";
import type { AnyBaseNode } from "../nodes/base-node";
import type { CanvasRenderer } from "../canvas-renderer";
import { createCanvasSurface } from "../canvas-utils";
import { BlurBackgroundNode } from "../nodes/blur-background-node";
import {
	CapinstaCaptionNode,
	renderCapinstaCaptionToContext,
} from "../nodes/capinsta-caption-node";
import { ColorNode } from "../nodes/color-node";
import { EffectLayerNode } from "../nodes/effect-layer-node";
import {
	GraphicNode,
	type ResolvedGraphicNodeState,
} from "../nodes/graphic-node";
import { MotionTemplateNode } from "../nodes/motion-template-node";
import { ImageNode } from "../nodes/image-node";
import { RootNode } from "../nodes/root-node";
import { StickerNode } from "../nodes/sticker-node";
import { renderTextToContext, TextNode } from "../nodes/text-node";
import { VideoNode } from "../nodes/video-node";
import type { ResolvedVisualSourceNodeState } from "../nodes/visual-node";
import type {
	FrameDescriptor,
	FrameItemDescriptor,
	LayerMaskDescriptor,
	QuadTransformDescriptor,
	TextureCanvasDrawFn,
	TextureUploadDescriptor,
} from "./types";
import { DEFAULT_GRAPHIC_SOURCE_SIZE } from "@/graphics";
import type { EvaluatedLayer3D, Point2D } from "@/layer-3d";
import { renderPaperFoldToContext } from "@/effects/paper-fold/render-canvas2d";
import { getGeneratedFoldAtlas } from "@/effects/paper-fold/assets";
import { buildPaperFoldGpuPass } from "@/effects/paper-fold/gpu";
import type { EffectPass } from "@/effects/types";

export async function buildFrameDescriptor({
	node,
	renderer,
}: {
	node: AnyBaseNode;
	renderer: CanvasRenderer;
}): Promise<{
	frame: FrameDescriptor;
	textures: TextureUploadDescriptor[];
}> {
	const items: FrameItemDescriptor[] = [];
	const textures = new Map<string, TextureUploadDescriptor>();

	await collectNode({
		node,
		renderer,
		path: "root",
		items,
		textures,
	});

	incrementCounter({ name: "frameItems", by: items.length });
	incrementCounter({ name: "frameTextures", by: textures.size });

	return {
		frame: {
			width: renderer.width,
			height: renderer.height,
			clear: {
				color: [0, 0, 0, 1],
			},
			items,
		},
		textures: [...textures.values()],
	};
}

async function collectNode({
	node,
	renderer,
	path,
	items,
	textures,
}: {
	node: AnyBaseNode;
	renderer: CanvasRenderer;
	path: string;
	items: FrameItemDescriptor[];
	textures: Map<string, TextureUploadDescriptor>;
}): Promise<void> {
	if (node instanceof RootNode) {
		for (let index = 0; index < node.children.length; index++) {
			await collectNode({
				node: node.children[index],
				renderer,
				path: `${path}:${index}`,
				items,
				textures,
			});
		}
		return;
	}

	if (node instanceof ColorNode) {
		const textureId = `${path}:color`;
		const { width, height } = renderer;
		textures.set(textureId, {
			kind: "rendered",
			id: textureId,
			contentHash: `color:${node.params.color}:${width}x${height}`,
			width,
			height,
			draw: (ctx) => {
				if (/gradient\(/i.test(node.params.color)) {
					drawCssBackground({ ctx, width, height, css: node.params.color });
				} else {
					ctx.fillStyle = node.params.color;
					ctx.fillRect(0, 0, width, height);
				}
			},
		});
		items.push({
			type: "layer",
			textureId,
			transform: fullCanvasTransform(renderer),
			opacity: 1,
			blendMode: "normal",
			effectPassGroups: [],
			mask: null,
		});
		return;
	}

	if (node instanceof EffectLayerNode) {
		if (!node.resolved || node.resolved.passes.length === 0) {
			return;
		}
		items.push({
			type: "sceneEffect",
			effectPassGroups: [node.resolved.passes],
		});
		return;
	}

	if (node instanceof BlurBackgroundNode) {
		if (!node.resolved) {
			return;
		}
		const textureId = `${path}:blur-background`;
		const { width, height } = renderer;
		const { backdropSource, passes } = node.resolved;
		// Backdrop pixels come from a decoded video/image frame whose identity
		// already changes when it changes. Hashing the source reference is
		// enough to let us skip redraws on frozen frames.
		const contentHash = `blur:${identityKey(backdropSource.source)}:${backdropSource.width}x${backdropSource.height}:${width}x${height}`;
		textures.set(textureId, {
			kind: "rendered",
			id: textureId,
			contentHash,
			width,
			height,
			draw: (ctx) => {
				const coverScale = Math.max(
					width / backdropSource.width,
					height / backdropSource.height,
				);
				const scaledWidth = backdropSource.width * coverScale;
				const scaledHeight = backdropSource.height * coverScale;
				const offsetX = (width - scaledWidth) / 2;
				const offsetY = (height - scaledHeight) / 2;
				ctx.drawImage(
					backdropSource.source,
					offsetX,
					offsetY,
					scaledWidth,
					scaledHeight,
				);
			},
		});
		items.push({
			type: "layer",
			textureId,
			transform: fullCanvasTransform(renderer),
			opacity: 1,
			blendMode: "normal",
			effectPassGroups: [passes],
			mask: null,
		});
		return;
	}

	if (
		node instanceof VideoNode ||
		node instanceof ImageNode ||
		node instanceof StickerNode ||
		node instanceof GraphicNode
	) {
		await collectVisualSourceNode({
			node,
			renderer,
			path,
			items,
			textures,
		});
		return;
	}

	if (node instanceof MotionTemplateNode) {
		if (!node.resolved) return;
		const textureId = `${path}:motion-template`;
		textures.set(textureId, {
			kind: "external",
			id: textureId,
			source: node.resolved.source,
			width: node.resolved.width,
			height: node.resolved.height,
		});
		items.push({
			type: "layer",
			textureId,
			transform: fullCanvasTransform(renderer),
			opacity: 1,
			blendMode: "normal",
			effectPassGroups: [],
			mask: null,
		});
		return;
	}

	if (node instanceof TextNode) {
		collectTextNode({
			node,
			renderer,
			path,
			items,
			textures,
		});
	}

	if (node instanceof CapinstaCaptionNode) {
		collectCapinstaCaptionNode({
			node,
			renderer,
			path,
			items,
			textures,
		});
	}
}

async function collectVisualSourceNode({
	node,
	renderer,
	path,
	items,
	textures,
}: {
	node: VideoNode | ImageNode | StickerNode | GraphicNode;
	renderer: CanvasRenderer;
	path: string;
	items: FrameItemDescriptor[];
	textures: Map<string, TextureUploadDescriptor>;
}) {
	if (!node.resolved) {
		return;
	}

	const source =
		node instanceof GraphicNode
			? node.getSource({ resolvedParams: node.resolved.resolvedParams })
			: node.resolved.source;
	if (!source) {
		return;
	}

	const sourceWidth =
		node instanceof GraphicNode
			? DEFAULT_GRAPHIC_SOURCE_SIZE
			: (node.resolved as ResolvedVisualSourceNodeState).sourceWidth;
	const sourceHeight =
		node instanceof GraphicNode
			? DEFAULT_GRAPHIC_SOURCE_SIZE
			: (node.resolved as ResolvedVisualSourceNodeState).sourceHeight;

	const textureId = `${path}:source`;
	const gpuPaperFold = node.resolved.paperFold
		? preparePaperFoldGpu({
				runtime: node.resolved.paperFold,
				width: sourceWidth,
				height: sourceHeight,
				textures,
			})
		: null;
	if (node.resolved.paperFold && !gpuPaperFold) {
		const runtime = node.resolved.paperFold;
		textures.set(textureId, {
			kind: "rendered",
			id: textureId,
			contentHash: `paper-fold:${identityKey(source)}:${sourceWidth}x${sourceHeight}:${JSON.stringify(runtime)}`,
			width: sourceWidth,
			height: sourceHeight,
			draw: (ctx) => {
				try {
					renderPaperFoldToContext({
						destination: ctx,
						source,
						sourceWidth,
						sourceHeight,
						outputWidth: sourceWidth,
						outputHeight: sourceHeight,
						runtime,
					});
				} catch (error) {
					warnPaperFoldOnce({ effectId: runtime.effectId, error });
					ctx.drawImage(source, 0, 0, sourceWidth, sourceHeight);
				}
			},
		});
	} else {
		textures.set(textureId, {
			kind: "external",
			id: textureId,
			source,
			width: sourceWidth,
			height: sourceHeight,
		});
	}

	const transform = computeVisualTransform({
		renderer,
		resolved: node.resolved,
		sourceWidth,
		sourceHeight,
	});
	if (node.resolved.layer3D) {
		const texture3DId = `${path}:source-3d`;
		const evaluated = applyBaseTransformToLayer3D({
			evaluated: node.resolved.layer3D,
			transform,
			renderer,
		});
		textures.delete(textureId);
		textures.set(texture3DId, {
			kind: "rendered",
			id: texture3DId,
			contentHash: `layer3d:${identityKey(source)}:${JSON.stringify(evaluated)}`,
			width: renderer.width,
			height: renderer.height,
			draw: (ctx) =>
				drawEvaluatedLayer3D({
					ctx,
					source,
					sourceWidth,
					sourceHeight,
					evaluated,
				}),
		});
		items.push({
			type: "layer",
			textureId: texture3DId,
			transform: fullCanvasTransform(renderer),
			opacity: node.resolved.opacity,
			blendMode: node.params.blendMode ?? "normal",
			effectPassGroups: node.resolved.effectPasses,
			mask: null,
		});
		return;
	}
	const { mask, strokeLayer } = buildMaskArtifacts({
		node,
		renderer,
		path,
		transform,
		textures,
	});

	items.push({
		type: "layer",
		textureId,
		transform,
		opacity: node.resolved.opacity,
		blendMode: node.params.blendMode ?? "normal",
		effectPassGroups: node.resolved.effectPasses,
		sourceEffectPassGroups: gpuPaperFold ? [[gpuPaperFold]] : [],
		mask,
	});
	if (strokeLayer) {
		items.push(strokeLayer);
	}
}

function applyBaseTransformToLayer3D({
	evaluated,
	transform,
	renderer,
}: {
	evaluated: EvaluatedLayer3D;
	transform: QuadTransformDescriptor;
	renderer: CanvasRenderer;
}): EvaluatedLayer3D {
	const angle = (transform.rotationDegrees * Math.PI) / 180;
	const cosine = Math.cos(angle);
	const sine = Math.sin(angle);
	const offsetX = transform.centerX - renderer.width / 2;
	const offsetY = transform.centerY - renderer.height / 2;
	const transformCorner = ({ point }: { point: Point2D }): Point2D => {
		const x = point.x - renderer.width / 2;
		const y = point.y - renderer.height / 2;
		return {
			x: renderer.width / 2 + x * cosine - y * sine + offsetX,
			y: renderer.height / 2 + x * sine + y * cosine + offsetY,
		};
	};
	return {
		...evaluated,
		projectedCorners: [
			transformCorner({ point: evaluated.projectedCorners[0] }),
			transformCorner({ point: evaluated.projectedCorners[1] }),
			transformCorner({ point: evaluated.projectedCorners[2] }),
			transformCorner({ point: evaluated.projectedCorners[3] }),
		],
	};
}

function drawEvaluatedLayer3D({
	ctx,
	source,
	sourceWidth,
	sourceHeight,
	evaluated,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	source: CanvasImageSource;
	sourceWidth: number;
	sourceHeight: number;
	evaluated: EvaluatedLayer3D;
}): void {
	const corners = evaluated.projectedCorners;
	if (evaluated.shadow.enabled) {
		ctx.save();
		ctx.filter = `blur(${Math.max(0, evaluated.shadow.blur)}px)`;
		ctx.fillStyle = `rgba(0,0,0,${evaluated.shadow.opacity})`;
		polygonPath({
			ctx,
			points: corners.map((point) => ({
				x: point.x + evaluated.shadow.offsetX,
				y: point.y + evaluated.shadow.offsetY,
			})),
		});
		ctx.fill();
		ctx.restore();
	}

	drawPerspectiveImage({
		ctx,
		source,
		sourceWidth,
		sourceHeight,
		corners,
	});

	ctx.save();
	polygonPath({ ctx, points: corners });
	ctx.clip();
	const brightness = Math.min(
		1.4,
		evaluated.material.ambient +
			evaluated.material.diffuse * evaluated.material.lightIntensity,
	);
	if (brightness < 1) {
		ctx.fillStyle = `rgba(0,0,0,${1 - brightness})`;
		ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
	} else if (brightness > 1) {
		ctx.fillStyle = colorWithAlpha({
			color: evaluated.material.lightColor,
			alpha: Math.min(0.35, brightness - 1),
		});
		ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
	}
	if (
		evaluated.material.lightingEnabled &&
		evaluated.material.sweepPosition !== null
	) {
		const minX = Math.min(...corners.map((point) => point.x));
		const maxX = Math.max(...corners.map((point) => point.x));
		const sweepX = minX + (maxX - minX) * evaluated.material.sweepPosition;
		const width = Math.max(20, (maxX - minX) * 0.32);
		const gradient = ctx.createLinearGradient(
			sweepX - width,
			0,
			sweepX + width,
			0,
		);
		gradient.addColorStop(0, "rgba(255,255,255,0)");
		gradient.addColorStop(
			0.5,
			colorWithAlpha({
				color: evaluated.material.lightColor,
				alpha: Math.min(
					0.8,
					evaluated.material.specular * evaluated.material.lightIntensity +
						evaluated.material.metallic * 0.18,
				),
			}),
		);
		gradient.addColorStop(1, "rgba(255,255,255,0)");
		ctx.globalCompositeOperation = "screen";
		ctx.fillStyle = gradient;
		ctx.fillRect(minX, 0, maxX - minX, ctx.canvas.height);
	}
	ctx.restore();
}

function drawPerspectiveImage({
	ctx,
	source,
	sourceWidth,
	sourceHeight,
	corners,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	source: CanvasImageSource;
	sourceWidth: number;
	sourceHeight: number;
	corners: [Point2D, Point2D, Point2D, Point2D];
}): void {
	const divisions = 8;
	for (let row = 0; row < divisions; row++) {
		for (let column = 0; column < divisions; column++) {
			const u0 = column / divisions;
			const u1 = (column + 1) / divisions;
			const v0 = row / divisions;
			const v1 = (row + 1) / divisions;
			const sourcePoints = [
				{ x: u0 * sourceWidth, y: v0 * sourceHeight },
				{ x: u1 * sourceWidth, y: v0 * sourceHeight },
				{ x: u1 * sourceWidth, y: v1 * sourceHeight },
				{ x: u0 * sourceWidth, y: v1 * sourceHeight },
			];
			const destination = [
				bilinearPoint({ corners, u: u0, v: v0 }),
				bilinearPoint({ corners, u: u1, v: v0 }),
				bilinearPoint({ corners, u: u1, v: v1 }),
				bilinearPoint({ corners, u: u0, v: v1 }),
			];
			drawMappedTriangle({
				ctx,
				source,
				sourcePoints: [sourcePoints[0], sourcePoints[1], sourcePoints[2]],
				destination: [destination[0], destination[1], destination[2]],
			});
			drawMappedTriangle({
				ctx,
				source,
				sourcePoints: [sourcePoints[0], sourcePoints[2], sourcePoints[3]],
				destination: [destination[0], destination[2], destination[3]],
			});
		}
	}
}

function bilinearPoint({
	corners,
	u,
	v,
}: {
	corners: [Point2D, Point2D, Point2D, Point2D];
	u: number;
	v: number;
}): Point2D {
	const top = {
		x: corners[0].x + (corners[1].x - corners[0].x) * u,
		y: corners[0].y + (corners[1].y - corners[0].y) * u,
	};
	const bottom = {
		x: corners[3].x + (corners[2].x - corners[3].x) * u,
		y: corners[3].y + (corners[2].y - corners[3].y) * u,
	};
	return {
		x: top.x + (bottom.x - top.x) * v,
		y: top.y + (bottom.y - top.y) * v,
	};
}

function drawMappedTriangle({
	ctx,
	source,
	sourcePoints,
	destination,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	source: CanvasImageSource;
	sourcePoints: [Point2D, Point2D, Point2D];
	destination: [Point2D, Point2D, Point2D];
}): void {
	const [s0, s1, s2] = sourcePoints;
	const [d0, d1, d2] = destination;
	const denominator =
		s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
	if (Math.abs(denominator) < 1e-8) return;
	const a =
		(d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) /
		denominator;
	const c =
		(d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) /
		denominator;
	const e =
		(d0.x * (s1.x * s2.y - s2.x * s1.y) +
			d1.x * (s2.x * s0.y - s0.x * s2.y) +
			d2.x * (s0.x * s1.y - s1.x * s0.y)) /
		denominator;
	const b =
		(d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) /
		denominator;
	const d =
		(d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) /
		denominator;
	const f =
		(d0.y * (s1.x * s2.y - s2.x * s1.y) +
			d1.y * (s2.x * s0.y - s0.x * s2.y) +
			d2.y * (s0.x * s1.y - s1.x * s0.y)) /
		denominator;
	ctx.save();
	polygonPath({ ctx, points: destination });
	ctx.clip();
	ctx.transform(a, b, c, d, e, f);
	ctx.drawImage(source, 0, 0);
	ctx.restore();
}

function polygonPath({
	ctx,
	points,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	points: Point2D[];
}): void {
	ctx.beginPath();
	ctx.moveTo(points[0].x, points[0].y);
	for (let index = 1; index < points.length; index++)
		ctx.lineTo(points[index].x, points[index].y);
	ctx.closePath();
}

function colorWithAlpha({
	color,
	alpha,
}: {
	color: string;
	alpha: number;
}): string {
	const red = Number.parseInt(color.slice(1, 3), 16);
	const green = Number.parseInt(color.slice(3, 5), 16);
	const blue = Number.parseInt(color.slice(5, 7), 16);
	return `rgba(${red},${green},${blue},${alpha})`;
}

function collectTextNode({
	node,
	renderer,
	path,
	items,
	textures,
}: {
	node: TextNode;
	renderer: CanvasRenderer;
	path: string;
	items: FrameItemDescriptor[];
	textures: Map<string, TextureUploadDescriptor>;
}) {
	if (!node.resolved) {
		return;
	}

	const textureId = `${path}:text`;
	const { width, height } = renderer;
	// Text output is fully determined by node.params + node.resolved. Both are
	// plain data we can stringify cheaply; the resolved measured layout is the
	// expensive part of text setup, so stringifying it here is orders of
	// magnitude cheaper than re-rasterizing when nothing changed.
	const contentHash = `text:${width}x${height}:${JSON.stringify({
		params: node.params,
		resolved: node.resolved,
	})}`;
	const gpuPaperFold = node.resolved.paperFold
		? preparePaperFoldGpu({
				runtime: node.resolved.paperFold,
				width,
				height,
				textures,
			})
		: null;
	textures.set(textureId, {
		kind: "rendered",
		id: textureId,
		contentHash,
		width,
		height,
		draw: (ctx) => {
			ctx.save();
			ctx.scale(renderer.renderScale, renderer.renderScale);
			renderTextToContext({ node, ctx });
			ctx.restore();
			if (node.resolved?.paperFold && !gpuPaperFold) {
				try {
					renderPaperFoldToContext({
						destination: ctx,
						source: ctx.canvas,
						sourceWidth: width,
						sourceHeight: height,
						outputWidth: width,
						outputHeight: height,
						runtime: node.resolved.paperFold,
					});
				} catch (error) {
					warnPaperFoldOnce({
						effectId: node.resolved.paperFold.effectId,
						error,
					});
				}
			}
		},
	});
	items.push({
		type: "layer",
		textureId,
		transform: fullCanvasTransform(renderer),
		opacity: node.resolved.opacity,
		blendMode: node.params.blendMode ?? "normal",
		effectPassGroups: node.resolved.effectPasses,
		sourceEffectPassGroups: gpuPaperFold ? [[gpuPaperFold]] : [],
		mask: null,
	});
}

function preparePaperFoldGpu({
	runtime,
	width,
	height,
	textures,
}: {
	runtime: NonNullable<ResolvedVisualSourceNodeState["paperFold"]>;
	width: number;
	height: number;
	textures: Map<string, TextureUploadDescriptor>;
}): EffectPass | null {
	try {
		const atlas = getGeneratedFoldAtlas({
			styleId: runtime.params.foldStyle,
			direction: runtime.params.foldDirection,
			origin: runtime.params.foldOrigin,
		});
		const atlasTextureId = `paper-fold-atlas:${runtime.params.foldStyle}:${runtime.params.foldDirection}:${runtime.params.foldOrigin}`;
		textures.set(atlasTextureId, {
			kind: "external",
			id: atlasTextureId,
			source: atlas.canvas,
			width: atlas.width,
			height: atlas.height,
		});
		return buildPaperFoldGpuPass({
			runtime,
			atlasTextureId,
			columns: atlas.columns,
			rows: atlas.rows,
			width,
			height,
		});
	} catch (error) {
		warnPaperFoldOnce({ effectId: runtime.effectId, error });
		return null;
	}
}

const paperFoldWarnings = new Set<string>();

function warnPaperFoldOnce({
	effectId,
	error,
}: {
	effectId: string;
	error: unknown;
}) {
	if (paperFoldWarnings.has(effectId)) return;
	paperFoldWarnings.add(effectId);
	console.warn("[paper-fold] Rendering fell back to the original source", {
		effectId,
		error: error instanceof Error ? error.message : String(error),
	});
}

function collectCapinstaCaptionNode({
	node,
	renderer,
	path,
	items,
	textures,
}: {
	node: CapinstaCaptionNode;
	renderer: CanvasRenderer;
	path: string;
	items: FrameItemDescriptor[];
	textures: Map<string, TextureUploadDescriptor>;
}) {
	if (!node.resolved) {
		return;
	}

	const textureId = `${path}:capinsta-caption`;
	const { width, height } = renderer;
	const contentHash = `capinsta-caption:${width}x${height}:${JSON.stringify({
		params: node.params,
		resolved: node.resolved,
	})}`;
	textures.set(textureId, {
		kind: "rendered",
		id: textureId,
		contentHash,
		width,
		height,
		draw: (ctx) => {
			ctx.save();
			ctx.scale(renderer.renderScale, renderer.renderScale);
			renderCapinstaCaptionToContext({ node, ctx });
			ctx.restore();
		},
	});
	items.push({
		type: "layer",
		textureId,
		transform: fullCanvasTransform(renderer),
		opacity: node.resolved.opacity,
		blendMode: node.params.blendMode ?? "normal",
		effectPassGroups: node.resolved.effectPasses,
		mask: null,
	});
}

function computeVisualTransform({
	renderer,
	resolved,
	sourceWidth,
	sourceHeight,
}: {
	renderer: CanvasRenderer;
	resolved: ResolvedVisualSourceNodeState | ResolvedGraphicNodeState;
	sourceWidth: number;
	sourceHeight: number;
}): QuadTransformDescriptor {
	const containScale = Math.min(
		renderer.width / sourceWidth,
		renderer.height / sourceHeight,
	);
	const scaledWidth = sourceWidth * containScale * resolved.transform.scaleX;
	const scaledHeight = sourceHeight * containScale * resolved.transform.scaleY;
	const absWidth = Math.abs(scaledWidth);
	const absHeight = Math.abs(scaledHeight);

	return {
		centerX:
			renderer.width / 2 + resolved.transform.position.x * renderer.renderScale,
		centerY:
			renderer.height / 2 +
			resolved.transform.position.y * renderer.renderScale,
		width: absWidth,
		height: absHeight,
		rotationDegrees: resolved.transform.rotate,
		flipX: scaledWidth < 0,
		flipY: scaledHeight < 0,
	};
}

function fullCanvasTransform(
	renderer: CanvasRenderer,
): QuadTransformDescriptor {
	return {
		centerX: renderer.width / 2,
		centerY: renderer.height / 2,
		width: renderer.width,
		height: renderer.height,
		rotationDegrees: 0,
		flipX: false,
		flipY: false,
	};
}

function buildMaskArtifacts({
	node,
	renderer,
	path,
	transform,
	textures,
}: {
	node: VideoNode | ImageNode | StickerNode | GraphicNode;
	renderer: CanvasRenderer;
	path: string;
	transform: QuadTransformDescriptor;
	textures: Map<string, TextureUploadDescriptor>;
}): {
	mask: LayerMaskDescriptor | null;
	strokeLayer: FrameItemDescriptor | null;
} {
	const mask = node.params.masks?.[0];
	if (!mask) {
		return { mask: null, strokeLayer: null };
	}

	const definition = getMaskDefinition(mask.type);

	if (definition.isActive?.(mask.params) === false) {
		return { mask: null, strokeLayer: null };
	}

	const { body } = definition.renderer;
	const usesOpaqueFastPath =
		body.kind === "drawWithFeather" &&
		mask.params.feather === 0 &&
		Boolean(body.opaqueFastPath);
	// drawWithFeather renderers encode feathering analytically in their canvas output
	// (e.g. split mask uses a linear gradient instead of JFA). The descriptor feather is
	// zeroed so the GPU compositor copies the mask texture as-is and does not run a second
	// JFA feather pass on top of an already-soft texture.
	const feather = body.kind === "drawWithFeather" ? 0 : mask.params.feather;

	const maskTextureId = `${path}:mask`;
	const { width: canvasWidth, height: canvasHeight } = renderer;
	const maskContentHash = `mask:${mask.type}:${JSON.stringify(mask.params)}:${transformHash(transform)}:${canvasWidth}x${canvasHeight}:body=${body.kind}:fastPath=${usesOpaqueFastPath}`;
	const drawMask: TextureCanvasDrawFn = (ctx) => {
		const { canvas: elementMaskCanvas, context: elementMaskCtx } =
			createCanvasSurface({
				width: Math.round(transform.width),
				height: Math.round(transform.height),
			});

		switch (body.kind) {
			case "fillPath": {
				const path2d = body.buildPath({
					resolvedParams: mask.params,
					width: transform.width,
					height: transform.height,
				});
				elementMaskCtx.fillStyle = "white";
				elementMaskCtx.fill(path2d);
				break;
			}
			case "drawOpaque":
				body.drawOpaque({
					resolvedParams: mask.params,
					ctx: elementMaskCtx,
					width: Math.round(transform.width),
					height: Math.round(transform.height),
				});
				break;
			case "drawWithFeather":
				if (usesOpaqueFastPath && body.opaqueFastPath) {
					const path2d = body.opaqueFastPath.buildPath({
						resolvedParams: mask.params,
						width: transform.width,
						height: transform.height,
					});
					elementMaskCtx.fillStyle = "white";
					elementMaskCtx.fill(path2d);
				} else {
					body.drawWithFeather({
						resolvedParams: mask.params,
						ctx: elementMaskCtx,
						width: Math.round(transform.width),
						height: Math.round(transform.height),
						feather: mask.params.feather,
					});
				}
				break;
		}

		drawTransformedCanvas({ ctx, source: elementMaskCanvas, transform });
	};
	textures.set(maskTextureId, {
		kind: "rendered",
		id: maskTextureId,
		contentHash: maskContentHash,
		width: canvasWidth,
		height: canvasHeight,
		draw: drawMask,
	});

	const stroke = definition.renderer.stroke;
	const hasStroke = mask.params.strokeWidth > 0 && Boolean(stroke);
	let strokeLayer: FrameItemDescriptor | null = null;
	if (hasStroke && stroke) {
		const strokeTextureId = `${path}:mask-stroke`;
		const strokeContentHash = `stroke:${mask.type}:${JSON.stringify(mask.params)}:${transformHash(transform)}:${canvasWidth}x${canvasHeight}:stroke=${stroke.kind}`;
		const drawStroke: TextureCanvasDrawFn = (ctx) => {
			const { canvas: strokeCanvas, context: strokeCtx } = createCanvasSurface({
				width: Math.round(transform.width),
				height: Math.round(transform.height),
			});

			switch (stroke.kind) {
				case "renderStroke":
					stroke.renderStroke({
						resolvedParams: mask.params,
						ctx: strokeCtx,
						width: transform.width,
						height: transform.height,
					});
					break;
				case "strokeFromPath": {
					const strokePath = stroke.buildStrokePath({
						resolvedParams: mask.params,
						width: transform.width,
						height: transform.height,
					});
					strokeCtx.strokeStyle = mask.params.strokeColor;
					strokeCtx.lineWidth = mask.params.strokeWidth;
					strokeCtx.stroke(strokePath);
					break;
				}
			}

			drawTransformedCanvas({ ctx, source: strokeCanvas, transform });
		};
		textures.set(strokeTextureId, {
			kind: "rendered",
			id: strokeTextureId,
			contentHash: strokeContentHash,
			width: canvasWidth,
			height: canvasHeight,
			draw: drawStroke,
		});
		strokeLayer = {
			type: "layer",
			textureId: strokeTextureId,
			transform: fullCanvasTransform(renderer),
			opacity: 1,
			blendMode: "normal",
			effectPassGroups: [],
			mask: null,
		};
	}

	return {
		mask: {
			textureId: maskTextureId,
			feather,
			inverted: mask.params.inverted,
		},
		strokeLayer,
	};
}

function drawTransformedCanvas({
	ctx,
	source,
	transform,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	source: CanvasImageSource;
	transform: QuadTransformDescriptor;
}) {
	const x = transform.centerX - transform.width / 2;
	const y = transform.centerY - transform.height / 2;
	const flipX = transform.flipX ? -1 : 1;
	const flipY = transform.flipY ? -1 : 1;
	const requiresTransform =
		transform.rotationDegrees !== 0 || flipX !== 1 || flipY !== 1;

	ctx.save();
	if (requiresTransform) {
		ctx.translate(transform.centerX, transform.centerY);
		ctx.rotate((transform.rotationDegrees * Math.PI) / 180);
		ctx.scale(flipX, flipY);
		ctx.translate(-transform.centerX, -transform.centerY);
	}
	ctx.drawImage(source, x, y, transform.width, transform.height);
	ctx.restore();
}

function transformHash(transform: QuadTransformDescriptor): string {
	return `${transform.centerX}:${transform.centerY}:${transform.width}:${transform.height}:${transform.rotationDegrees}:${transform.flipX ? 1 : 0}:${transform.flipY ? 1 : 0}`;
}

// Stable identity key for CanvasImageSource. Using a WeakMap → counter keeps
// hash string length bounded and avoids holding sources alive.
const identityKeys = new WeakMap<object, number>();
let nextIdentity = 1;
function identityKey(source: CanvasImageSource): string {
	if (typeof source === "object" && source !== null) {
		let key = identityKeys.get(source);
		if (key === undefined) {
			key = nextIdentity++;
			identityKeys.set(source, key);
		}
		return `@${key}`;
	}
	return "@?";
}
