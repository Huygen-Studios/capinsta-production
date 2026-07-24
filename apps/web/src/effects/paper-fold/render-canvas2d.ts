/* eslint-disable opencut/prefer-object-params -- low-level canvas helpers are positional in hot loops */
import { getGeneratedFoldFrame } from "./assets";
import type { PaperFoldRuntimeState } from "./types";

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Surface = HTMLCanvasElement | OffscreenCanvas;

interface ScratchSet {
	width: number;
	height: number;
	original: Surface;
	media: Surface;
	masked: Surface;
	assembled: Surface;
	transformed: Surface;
	lastUsed: number;
}

const scratchCache = new Map<string, ScratchSet>();
const MAX_SCRATCH_SETS = 24;
let useCounter = 0;

export function renderPaperFoldToContext({
	destination,
	source,
	sourceWidth,
	sourceHeight,
	outputWidth,
	outputHeight,
	runtime,
}: {
	destination: Context2D;
	source: CanvasImageSource;
	sourceWidth: number;
	sourceHeight: number;
	outputWidth: number;
	outputHeight: number;
	runtime: PaperFoldRuntimeState;
}): void {
	const width = Math.max(1, Math.round(outputWidth));
	const height = Math.max(1, Math.round(outputHeight));
	const params = runtime.params;
	const scratch = acquireScratch({
		key: runtime.effectId,
		width,
		height,
	});
	const originalContext = context2d(scratch.original);
	const mediaContext = context2d(scratch.media);
	const maskedContext = context2d(scratch.masked);
	const assembledContext = context2d(scratch.assembled);
	const transformedContext = context2d(scratch.transformed);
	for (const context of [
		originalContext,
		mediaContext,
		maskedContext,
		assembledContext,
		transformedContext,
	]) {
		reset(context, width, height);
	}

	drawFittedMedia({
		context: originalContext,
		source,
		sourceWidth,
		sourceHeight,
		width,
		height,
		fitMode: "stretch",
		scale: 1,
		rotation: 0,
		positionX: 0,
		positionY: 0,
		opacity: 1,
	});
	drawFittedMedia({
		context: mediaContext,
		source,
		sourceWidth,
		sourceHeight,
		width,
		height,
		fitMode: params.fitMode,
		scale: params.mediaScale,
		rotation: params.mediaRotation,
		positionX: params.mediaPositionX,
		positionY: params.mediaPositionY,
		opacity: params.mediaOpacity,
	});
	if (
		params.alphaMode !== "source-alpha" ||
		params.alphaThreshold > 0 ||
		params.alphaFeather > 0
	) {
		applyAlphaProcessing({
			context: mediaContext,
			width,
			height,
			runtime,
		});
	}

	const frame = getGeneratedFoldFrame({
		styleId: params.foldStyle,
		frameIndex: runtime.frameState.frameIndex,
		direction: params.foldDirection,
		origin: params.foldOrigin,
	});

	maskedContext.drawImage(scratch.media, 0, 0);
	maskedContext.globalCompositeOperation = "destination-in";
	maskedContext.globalAlpha = Math.min(1, params.foldIntensity);
	maskedContext.drawImage(frame.matte, 0, 0, width, height);
	maskedContext.globalCompositeOperation = "source-over";
	maskedContext.globalAlpha = 1;

	if (params.shadowEnabled && params.shadowOpacity > 0) {
		const radians = (params.shadowAngle * Math.PI) / 180;
		assembledContext.save();
		assembledContext.globalAlpha = params.shadowOpacity;
		assembledContext.filter = `blur(${params.shadowBlur}px)`;
		assembledContext.shadowColor = params.shadowColor;
		assembledContext.shadowBlur = params.shadowBlur;
		assembledContext.shadowOffsetX = Math.cos(radians) * params.shadowDistance;
		assembledContext.shadowOffsetY = Math.sin(radians) * params.shadowDistance;
		assembledContext.drawImage(frame.matte, 0, 0, width, height);
		assembledContext.restore();
	}

	if (params.borderEnabled && params.borderWidth > 0) {
		drawBorder({
			context: assembledContext,
			matte: frame.matte,
			width,
			height,
			lineWidth: params.borderWidth,
			color: params.borderColor,
		});
	}
	assembledContext.drawImage(scratch.masked, 0, 0);
	drawPaper({
		context: assembledContext,
		paper: frame.paper,
		width,
		height,
		runtime,
	});

	transformedContext.save();
	const centerX = width / 2;
	const centerY = height / 2;
	transformedContext.translate(
		centerX + params.positionX + runtime.frameState.offsetX,
		centerY + params.positionY + runtime.frameState.offsetY,
	);
	transformedContext.rotate(
		((params.rotation + runtime.frameState.rotationDegrees) * Math.PI) / 180,
	);
	transformedContext.scale(
		params.scale * (params.flipHorizontal ? -1 : 1),
		params.scale * (params.flipVertical ? -1 : 1),
	);
	transformedContext.translate(-centerX, -centerY);
	transformedContext.drawImage(scratch.assembled, 0, 0);
	transformedContext.restore();

	reset(destination, width, height);
	if (params.mixWithOriginal > 0) {
		destination.globalAlpha = params.mixWithOriginal;
		destination.drawImage(scratch.original, 0, 0);
	}
	destination.globalAlpha =
		params.overallOpacity * (1 - params.mixWithOriginal);
	destination.drawImage(scratch.transformed, 0, 0);
	destination.globalAlpha = 1;
}

export function releasePaperFoldScratch(effectId?: string): void {
	if (effectId) {
		for (const key of scratchCache.keys()) {
			if (key.startsWith(`${effectId}:`)) scratchCache.delete(key);
		}
		return;
	}
	scratchCache.clear();
}

function drawFittedMedia({
	context,
	source,
	sourceWidth,
	sourceHeight,
	width,
	height,
	fitMode,
	scale,
	rotation,
	positionX,
	positionY,
	opacity,
}: {
	context: Context2D;
	source: CanvasImageSource;
	sourceWidth: number;
	sourceHeight: number;
	width: number;
	height: number;
	fitMode: "contain" | "cover" | "stretch";
	scale: number;
	rotation: number;
	positionX: number;
	positionY: number;
	opacity: number;
}) {
	let drawWidth = width;
	let drawHeight = height;
	if (fitMode !== "stretch") {
		const fit =
			fitMode === "cover"
				? Math.max(width / sourceWidth, height / sourceHeight)
				: Math.min(width / sourceWidth, height / sourceHeight);
		drawWidth = sourceWidth * fit;
		drawHeight = sourceHeight * fit;
	}
	context.save();
	context.globalAlpha = opacity;
	context.translate(width / 2 + positionX, height / 2 + positionY);
	context.rotate((rotation * Math.PI) / 180);
	context.scale(scale, scale);
	context.drawImage(
		source,
		-drawWidth / 2,
		-drawHeight / 2,
		drawWidth,
		drawHeight,
	);
	context.restore();
}

function applyAlphaProcessing({
	context,
	width,
	height,
	runtime,
}: {
	context: Context2D;
	width: number;
	height: number;
	runtime: PaperFoldRuntimeState;
}) {
	const params = runtime.params;
	const image = context.getImageData(0, 0, width, height);
	const data = image.data;
	const key = parseHexColor(params.keyColor);
	const threshold = params.alphaThreshold * 255;
	const feather = Math.max(1, params.alphaFeather * 255);
	for (let index = 0; index < data.length; index += 4) {
		const red = data[index];
		const green = data[index + 1];
		const blue = data[index + 2];
		let alpha = data[index + 3] / 255;
		if (params.alphaMode === "luma") {
			alpha *= (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
		} else if (params.alphaMode === "green-screen") {
			const distance =
				Math.hypot(red - key[0], green - key[1], blue - key[2]) /
				(255 * Math.sqrt(3));
			const keep = smoothstep(
				params.keySimilarity,
				params.keySimilarity + Math.max(0.001, params.keySmoothness),
				distance,
			);
			alpha *= keep;
			const dominance = Math.max(0, green - Math.max(red, blue));
			data[index + 1] = Math.max(
				0,
				green - dominance * params.spillSuppression * Math.max(0, 1 - keep),
			);
		}
		const alphaByte = alpha * 255;
		data[index + 3] =
			threshold <= 0
				? Math.round(alphaByte)
				: Math.round(
						255 *
							smoothstep(
								Math.max(0, threshold - feather),
								Math.min(255, threshold + feather),
								alphaByte,
							),
					);
	}
	context.putImageData(image, 0, 0);
}

function drawBorder({
	context,
	matte,
	width,
	height,
	lineWidth,
	color,
}: {
	context: Context2D;
	matte: CanvasImageSource;
	width: number;
	height: number;
	lineWidth: number;
	color: string;
}) {
	context.save();
	context.globalAlpha = 0.9;
	context.shadowColor = color;
	context.shadowBlur = Math.max(1, lineWidth);
	for (const [x, y] of [
		[-lineWidth, 0],
		[lineWidth, 0],
		[0, -lineWidth],
		[0, lineWidth],
	] as const) {
		context.shadowOffsetX = x;
		context.shadowOffsetY = y;
		context.drawImage(matte, 0, 0, width, height);
	}
	context.restore();
}

function drawPaper({
	context,
	paper,
	width,
	height,
	runtime,
}: {
	context: Context2D;
	paper: CanvasImageSource;
	width: number;
	height: number;
	runtime: PaperFoldRuntimeState;
}) {
	const params = runtime.params;
	context.save();
	context.translate(
		width / 2 + params.paperPositionX,
		height / 2 + params.paperPositionY,
	);
	context.rotate((params.paperRotation * Math.PI) / 180);
	context.scale(params.paperScale, params.paperScale);
	context.translate(-width / 2, -height / 2);
	context.globalAlpha = params.paperOpacity;
	context.filter = [
		`brightness(${Math.pow(2, params.exposure)})`,
		`contrast(${params.contrast})`,
		`saturate(${params.saturation})`,
	].join(" ");
	context.drawImage(paper, 0, 0, width, height);
	context.filter = "none";
	if (params.paperTintAmount > 0) {
		context.globalCompositeOperation = "source-atop";
		context.globalAlpha = params.paperTintAmount;
		context.fillStyle = params.paperColor;
		context.fillRect(0, 0, width, height);
	}
	if (params.paperTextureAmount > 0 || params.noiseAmount > 0) {
		context.globalCompositeOperation = "source-atop";
		context.globalAlpha = Math.min(
			0.7,
			params.paperTextureAmount * 0.35 + params.noiseAmount * 0.25,
		);
		context.strokeStyle = "#5f513c";
		context.lineWidth = 1;
		const spacing = Math.max(3, 14 - params.paperTextureAmount * 10);
		for (let y = 0; y < height; y += spacing) {
			const jitter = seededSigned(
				params.randomSeed + runtime.frameState.frameIndex * 131 + y,
			);
			context.beginPath();
			context.moveTo(0, y + jitter * 2);
			context.lineTo(width, y - jitter * 2);
			context.stroke();
		}
	}
	if (params.halftoneAmount > 0) {
		context.globalCompositeOperation = "source-atop";
		context.globalAlpha = params.halftoneAmount * 0.3;
		context.fillStyle = "#2f291f";
		const spacing = Math.max(4, 12 - params.halftoneAmount * 7);
		for (let y = spacing / 2; y < height; y += spacing) {
			for (let x = spacing / 2; x < width; x += spacing) {
				context.beginPath();
				context.arc(x, y, spacing * 0.16, 0, Math.PI * 2);
				context.fill();
			}
		}
	}
	context.restore();
}

function acquireScratch({
	key,
	width,
	height,
}: {
	key: string;
	width: number;
	height: number;
}): ScratchSet {
	const cacheKey = `${key}:${width}x${height}`;
	const existing = scratchCache.get(cacheKey);
	if (existing) {
		existing.lastUsed = ++useCounter;
		return existing;
	}
	const created: ScratchSet = {
		width,
		height,
		original: createSurface(width, height),
		media: createSurface(width, height),
		masked: createSurface(width, height),
		assembled: createSurface(width, height),
		transformed: createSurface(width, height),
		lastUsed: ++useCounter,
	};
	scratchCache.set(cacheKey, created);
	if (scratchCache.size > MAX_SCRATCH_SETS) {
		const oldest = [...scratchCache.entries()].sort(
			(left, right) => left[1].lastUsed - right[1].lastUsed,
		)[0];
		if (oldest) scratchCache.delete(oldest[0]);
	}
	return created;
}

function createSurface(width: number, height: number): Surface {
	if (typeof OffscreenCanvas !== "undefined")
		return new OffscreenCanvas(width, height);
	if (typeof document !== "undefined") {
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		return canvas;
	}
	throw new Error("Paper Fold requires OffscreenCanvas or an HTML canvas");
}

function context2d(surface: Surface): Context2D {
	const context = surface.getContext("2d");
	if (!context || !("drawImage" in context))
		throw new Error("Paper Fold could not acquire a 2D context");
	return context as Context2D;
}

function reset(context: Context2D, width: number, height: number) {
	context.setTransform(1, 0, 0, 1, 0, 0);
	context.globalAlpha = 1;
	context.globalCompositeOperation = "source-over";
	context.filter = "none";
	context.shadowBlur = 0;
	context.shadowOffsetX = 0;
	context.shadowOffsetY = 0;
	context.clearRect(0, 0, width, height);
}

function parseHexColor(value: string): [number, number, number] {
	const normalized = value.replace("#", "");
	if (!/^[0-9a-f]{6}$/i.test(normalized)) return [0, 255, 0];
	return [
		Number.parseInt(normalized.slice(0, 2), 16),
		Number.parseInt(normalized.slice(2, 4), 16),
		Number.parseInt(normalized.slice(4, 6), 16),
	];
}

function smoothstep(edge0: number, edge1: number, value: number) {
	const range = Math.max(0.000001, edge1 - edge0);
	const t = Math.min(1, Math.max(0, (value - edge0) / range));
	return t * t * (3 - 2 * t);
}

function seededSigned(seed: number) {
	let value = seed | 0;
	value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
	value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
	return (((value ^ (value >>> 16)) >>> 0) / 0xffffffff) * 2 - 1;
}
