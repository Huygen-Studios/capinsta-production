import type { CapinstaTextRenderData } from "../exportRender";
import { getWordDisplayText } from "../original/captionUtils";
import {
	backgroundRgba,
	directionalShadow,
	resolveFontFamily,
} from "../original/captionStyleConfig";
import {
	type CaptionCanvasSize,
} from "../original/captionLayoutSafety";
import type { AlignedWord, CaptionStyleConfig } from "../original/types";
import { createCapinstaRenderModelFromExportData } from "../render/capinstaRenderModel";

interface ExportAlignedWord extends AlignedWord {
	id: string;
}

export interface CapinstaWysiwygExportDebug {
	rendererPath: "rendered_capinsta_wysiwyg";
	rendererStrategy: string;
	clipId: string;
	clipText: string;
	presetId: string;
	activeWordIds: string[];
	activeWordColor: string;
	fontSize: number;
	box: { x: number; y: number; width: number; height: number };
	manifest: ReturnType<typeof createCapinstaRenderModelFromExportData>["manifest"];
}

export interface CapinstaWysiwygExportResult {
	debug: CapinstaWysiwygExportDebug;
}

function clamp({
	value,
	min,
	max,
}: {
	value: number;
	min: number;
	max: number;
}) {
	return Math.min(max, Math.max(min, value));
}

function roundedRect({
	ctx,
	x,
	y,
	width,
	height,
	radius,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	x: number;
	y: number;
	width: number;
	height: number;
	radius: number;
}) {
	const safeRadius = clamp({
		value: radius,
		min: 0,
		max: Math.min(width, height) / 2,
	});
	ctx.beginPath();
	ctx.roundRect(x, y, width, height, safeRadius);
}

function toAlignedWords(renderData: CapinstaTextRenderData): ExportAlignedWord[] {
	return renderData.words.map((word) => ({
		id: word.id,
		word: word.text,
		displayedWord: word.text,
		start: word.start,
		end: word.end,
		score: 1,
	}));
}

function tokenText(word: AlignedWord) {
	return getWordDisplayText(word).trim();
}

function buildLines({
	ctx,
	words,
	config,
	maxWidth,
	fontSize,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	words: ExportAlignedWord[];
	config: CaptionStyleConfig;
	maxWidth: number;
	fontSize: number;
}): ExportAlignedWord[][] {
	ctx.font = `${config.fontWeight} ${fontSize}px ${resolveFontFamily(config.fontFamily)}, sans-serif`;
	const maxLines = config.maxLines === "auto" ? 2 : config.maxLines;
	const gap = fontSize * 0.32;
	const lines: ExportAlignedWord[][] = [];
	let current: ExportAlignedWord[] = [];
	let currentWidth = 0;

	for (const word of words) {
		const text = tokenText(word);
		if (!text) continue;
		const width = ctx.measureText(text).width;
		const nextWidth = current.length ? currentWidth + gap + width : width;
		if (current.length && nextWidth > maxWidth && lines.length < maxLines - 1) {
			lines.push(current);
			current = [word];
			currentWidth = width;
		} else {
			current.push(word);
			currentWidth = nextWidth;
		}
	}
	if (current.length) lines.push(current);
	return lines.slice(0, maxLines);
}

function measureLine({
	ctx,
	line,
	fontSize,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	line: ExportAlignedWord[];
	fontSize: number;
}) {
	const gap = fontSize * 0.32;
	return line.reduce(
		(width, word, index) =>
			width + ctx.measureText(tokenText(word)).width + (index > 0 ? gap : 0),
		0,
	);
}

function drawTextWithOptionalStroke({
	ctx,
	text,
	x,
	y,
	config,
	fillStyle,
	scale,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	text: string;
	x: number;
	y: number;
	config: CaptionStyleConfig;
	fillStyle: string;
	scale: number;
}) {
	if (config.textStrokeEnabled && config.textStrokeWidth > 0) {
		ctx.lineJoin = "round";
		ctx.lineWidth = config.textStrokeWidth * scale;
		ctx.strokeStyle = config.textStrokeColor;
		ctx.strokeText(text, x, y);
	}
	ctx.fillStyle = fillStyle;
	ctx.fillText(text, x, y);
}

function setShadowFromConfig({
	ctx,
	config,
	scale,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	config: CaptionStyleConfig;
	scale: number;
}) {
	if (!config.textShadowEnabled) {
		ctx.shadowColor = "transparent";
		ctx.shadowOffsetX = 0;
		ctx.shadowOffsetY = 0;
		ctx.shadowBlur = 0;
		return;
	}
	const shadow = directionalShadow(
		config.textShadowColor,
		config.textShadowOpacity,
		config.textShadowDistance * scale,
		config.textShadowBlur * scale,
		config.textShadowAngle,
	);
	const parts = /(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+(.+)/.exec(shadow);
	if (!parts) return;
	ctx.shadowOffsetX = Number(parts[1]);
	ctx.shadowOffsetY = Number(parts[2]);
	ctx.shadowBlur = Number(parts[3]);
	ctx.shadowColor = parts[4] ?? "transparent";
}

function wordFillColor({
	word,
	active,
	config,
	presetId,
}: {
	word: ExportAlignedWord;
	active: boolean;
	config: CaptionStyleConfig;
	presetId: string;
}) {
	const defaultColor = config.textColor || "#ffffff";
	if (active) return config.activeWordColor || defaultColor;
	if (presetId !== "mrbeast_style" || !config.smartHighlightEnabled) {
		return defaultColor;
	}
	const clean = tokenText(word).toLowerCase().replace(/[^a-z0-9]/g, "");
	const money = new Set(["money", "cash", "dollar", "rupee", "lakh", "crore", "win", "winning", "prize", "loss", "profit"]);
	const danger = new Set(["fail", "failed", "lose", "lost", "loss", "wrong", "bad", "stop"]);
	const growth = new Set(["grow", "growth", "viral", "million", "10000", "100000", "success"]);
	if (danger.has(clean)) return config.emphasisRedColor || defaultColor;
	if (money.has(clean) || growth.has(clean)) {
		return config.emphasisYellowColor || config.activeWordColor || defaultColor;
	}
	return defaultColor;
}

function drawInlinePresetCaption({
	ctx,
	renderData,
	activeWordIds,
	timeSeconds,
	canvasSize,
	strategy,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	renderData: CapinstaTextRenderData;
	activeWordIds: string[];
	timeSeconds: number;
	canvasSize: CaptionCanvasSize;
	strategy:
		| "kinetic_fade"
		| "attention_punch"
		| "mrbeast_style"
		| "apple_cinematic"
		| "dynamic_punch";
}): CapinstaWysiwygExportResult {
	const model = createCapinstaRenderModelFromExportData({
		renderData,
		activeWordIds,
		rendererPath: "rendered_capinsta_wysiwyg",
		viewport: canvasSize,
	});
	const config = model.normalizedStyleConfig;
	const allWords = toAlignedWords(renderData);
	const activeIds = new Set(activeWordIds);
	const layout = model.layout;
	if (!layout) {
		return emptyResult({ renderData, activeWordIds, config, model, strategy });
	}
	const fontSize = layout.fontSize;
	const scale = layout.groupScale;
	const maxWidth = (canvasSize.width * layout.widthPercent) / 100;
	const centerX = (layout.xPercent / 100) * canvasSize.width;
	const centerY = (layout.yPercent / 100) * canvasSize.height;
	const words =
		strategy === "apple_cinematic" || strategy === "kinetic_fade"
			? allWords.filter((word) => timeSeconds >= word.start)
			: allWords;
	const safeWords = words.length ? words : allWords.slice(0, 1);
	const lineHeight = fontSize * config.lineHeight;
	const rowGap = fontSize * 0.08;

	ctx.save();
	ctx.font = `${config.fontWeight} ${fontSize}px ${resolveFontFamily(config.fontFamily)}, sans-serif`;
	ctx.textAlign = "left";
	ctx.textBaseline = "middle";
	setShadowFromConfig({ ctx, config, scale });

	const lines = buildLines({ ctx, words: safeWords, config, maxWidth, fontSize });
	const lineWidths = lines.map((line) => measureLine({ ctx, line, fontSize }));
	const contentWidth = Math.max(1, ...lineWidths);
	const contentHeight =
		lines.length * lineHeight + Math.max(0, lines.length - 1) * rowGap;
	const boxX = centerX - contentWidth / 2;
	const boxY = centerY - contentHeight / 2;

	ctx.translate(centerX, centerY);
	if (config.rotation) ctx.rotate((config.rotation * Math.PI) / 180);
	ctx.translate(-centerX, -centerY);

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const line = lines[lineIndex];
		let x =
			config.alignment === "left"
				? centerX - maxWidth / 2
				: config.alignment === "right"
					? centerX + maxWidth / 2 - (lineWidths[lineIndex] ?? 0)
					: centerX - (lineWidths[lineIndex] ?? 0) / 2;
		const y =
			boxY + lineHeight / 2 + lineIndex * (lineHeight + rowGap);

		for (const word of line) {
			const text = tokenText(word);
			const active = activeIds.has(word.id);
			const wordWidth = ctx.measureText(text).width;
			const age = Math.max(0, timeSeconds - word.start);
			const reveal = Math.min(1, age / Math.max(0.08, config.revealDuration || 0.18));
			const activeScale =
				active && (strategy === "attention_punch" || strategy === "mrbeast_style")
					? config.activeWordScale
					: 1;
			const alpha =
				strategy === "apple_cinematic" || strategy === "kinetic_fade"
					? reveal
					: timeSeconds >= word.start
						? 1
						: 0;
			const yOffset =
				strategy === "apple_cinematic"
					? (1 - reveal) * Math.max(0, config.revealYOffset ?? 0)
					: strategy === "kinetic_fade"
						? (1 - reveal) * 10
						: active
							? -2 * scale
							: 0;

			ctx.save();
			ctx.globalAlpha = alpha;
			if (strategy === "mrbeast_style" && config.randomTiltEnabled) {
				const tilt = ((stableWordHash(text) % 7) - 3) * 0.7;
				ctx.translate(x + wordWidth / 2, y + yOffset);
				ctx.rotate((tilt * Math.PI) / 180);
				ctx.scale(activeScale, activeScale);
				drawTextWithOptionalStroke({
					ctx,
					text,
					x: -wordWidth / 2,
					y: 0,
					config,
					fillStyle: wordFillColor({ word, active, config, presetId: strategy }),
					scale,
				});
			} else {
				ctx.translate(x + wordWidth / 2, y + yOffset);
				ctx.scale(activeScale, activeScale);
				drawTextWithOptionalStroke({
					ctx,
					text,
					x: -wordWidth / 2,
					y: 0,
					config,
					fillStyle: wordFillColor({ word, active, config, presetId: strategy }),
					scale,
				});
			}
			ctx.restore();
			x += wordWidth + fontSize * 0.32;
		}
	}

	ctx.restore();
	return {
		debug: {
			rendererPath: "rendered_capinsta_wysiwyg",
			rendererStrategy: strategy,
			clipId: renderData.clipId,
			clipText: renderData.clipText,
			presetId: renderData.captionStyle.presetId,
			activeWordIds,
			activeWordColor: config.activeWordColor,
			fontSize,
			box: { x: boxX, y: boxY, width: contentWidth, height: contentHeight },
			manifest: {
				...model.manifest,
				finalFontSize: fontSize,
				finalPosition: { xPercent: layout.xPercent, yPercent: layout.yPercent },
				finalBackgroundBox: {
					widthPercent: layout.widthPercent,
					heightPercent: layout.maxHeightPercent ?? null,
				},
			},
		},
	};
}

function stableWordHash(value: string) {
	let hash = 0;
	for (let index = 0; index < value.length; index += 1) {
		hash = (hash << 5) - hash + value.charCodeAt(index);
		hash |= 0;
	}
	return Math.abs(hash);
}

function drawEditorialLockupCaption({
	ctx,
	renderData,
	activeWordIds,
	timeSeconds,
	canvasSize,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	renderData: CapinstaTextRenderData;
	activeWordIds: string[];
	timeSeconds: number;
	canvasSize: CaptionCanvasSize;
}): CapinstaWysiwygExportResult {
	const model = createCapinstaRenderModelFromExportData({
		renderData,
		activeWordIds,
		rendererPath: "rendered_capinsta_wysiwyg",
		viewport: canvasSize,
	});
	const config = model.normalizedStyleConfig;
	const layout = model.layout;
	if (!layout) {
		return emptyResult({
			renderData,
			activeWordIds,
			config,
			model,
			strategy: "modern_minimalist_lockup",
		});
	}
	const visibleWords = toAlignedWords(renderData).filter(
		(word) => timeSeconds >= word.start,
	);
	const words = visibleWords.length ? visibleWords : toAlignedWords(renderData).slice(0, 1);
	const activeIds = new Set(activeWordIds);
	const anchor =
		words.find((word) => activeIds.has(word.id)) ??
		words.slice().sort((left, right) => tokenText(right).length - tokenText(left).length)[0]!;
	const support = words.filter((word) => word.id !== anchor.id);
	const scale = layout.groupScale;
	const anchorSize = Math.max(
		layout.fontSize,
		(config.bigFontSizePx ?? config.fontSize) * scale,
	);
	const supportSize = Math.max(
		12,
		(config.smallFontSizePx ?? config.fontSize * 0.55) * scale,
	);
	const centerX = (layout.xPercent / 100) * canvasSize.width;
	const centerY = (layout.yPercent / 100) * canvasSize.height;
	const maxWidth = (canvasSize.width * layout.widthPercent) / 100;
	const anchorText = tokenText(anchor);
	const supportText = support.map(tokenText).filter(Boolean).join(" ");

	ctx.save();
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	setShadowFromConfig({ ctx, config, scale });

	ctx.font = `${config.fontWeight} ${anchorSize}px ${resolveFontFamily(config.bigFontFamily || config.fontFamily)}, sans-serif`;
	const anchorWidth = Math.min(maxWidth, ctx.measureText(anchorText).width);
	ctx.save();
	const anchorAge = Math.max(0, timeSeconds - anchor.start);
	const anchorReveal = Math.min(1, anchorAge / Math.max(0.08, config.revealDuration || 0.16));
	ctx.globalAlpha = anchorReveal;
	drawTextWithOptionalStroke({
		ctx,
		text: anchorText,
		x: centerX + maxWidth * 0.08,
		y: centerY - supportSize * 0.15,
		config,
		fillStyle: activeIds.has(anchor.id) ? config.activeWordColor : config.textColor,
		scale,
	});
	ctx.restore();

	if (supportText) {
		ctx.font = `${config.fontWeight} ${supportSize}px ${resolveFontFamily(config.smallFontFamily || config.fontFamily)}, sans-serif`;
		ctx.save();
		ctx.globalAlpha = 1;
		drawTextWithOptionalStroke({
			ctx,
			text: supportText,
			x: centerX - maxWidth * 0.12,
			y: centerY + anchorSize * 0.48,
			config,
			fillStyle: config.textColor,
			scale,
		});
		ctx.restore();
	}

	ctx.restore();
	return {
		debug: {
			rendererPath: "rendered_capinsta_wysiwyg",
			rendererStrategy: "modern_minimalist_lockup",
			clipId: renderData.clipId,
			clipText: renderData.clipText,
			presetId: renderData.captionStyle.presetId,
			activeWordIds,
			activeWordColor: config.activeWordColor,
			fontSize: anchorSize,
			box: {
				x: centerX - maxWidth / 2,
				y: centerY - anchorSize,
				width: Math.max(anchorWidth, maxWidth * 0.45),
				height: anchorSize + supportSize * 1.6,
			},
			manifest: {
				...model.manifest,
				finalFontSize: anchorSize,
				finalPosition: { xPercent: layout.xPercent, yPercent: layout.yPercent },
				finalBackgroundBox: {
					widthPercent: layout.widthPercent,
					heightPercent: layout.maxHeightPercent ?? null,
				},
			},
		},
	};
}

function emptyResult({
	renderData,
	activeWordIds,
	config,
	model,
	strategy,
}: {
	renderData: CapinstaTextRenderData;
	activeWordIds: string[];
	config: CaptionStyleConfig;
	model: ReturnType<typeof createCapinstaRenderModelFromExportData>;
	strategy: string;
}): CapinstaWysiwygExportResult {
	return {
		debug: {
			rendererPath: "rendered_capinsta_wysiwyg",
			rendererStrategy: strategy,
			clipId: renderData.clipId,
			clipText: renderData.clipText,
			presetId: renderData.captionStyle.presetId,
			activeWordIds,
			activeWordColor: config.activeWordColor,
			fontSize: 0,
			box: { x: 0, y: 0, width: 0, height: 0 },
			manifest: model.manifest,
		},
	};
}

function drawWordHighlightBoxCaption({
	ctx,
	renderData,
	activeWordIds,
	canvasSize,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	renderData: CapinstaTextRenderData;
	activeWordIds: string[];
	canvasSize: CaptionCanvasSize;
}): CapinstaWysiwygExportResult {
	const model = createCapinstaRenderModelFromExportData({
		renderData,
		activeWordIds,
		rendererPath: "rendered_capinsta_wysiwyg",
		viewport: canvasSize,
	});
	const config = model.normalizedStyleConfig;
	const words = toAlignedWords(renderData);
	const activeIds = new Set(activeWordIds);
	const layout = model.layout;
	if (!layout) {
		return {
			debug: {
				rendererPath: "rendered_capinsta_wysiwyg",
				rendererStrategy: "word_highlight_box",
				clipId: renderData.clipId,
				clipText: renderData.clipText,
				presetId: renderData.captionStyle.presetId,
				activeWordIds,
				activeWordColor: config.activeWordColor,
				fontSize: 0,
				box: { x: 0, y: 0, width: 0, height: 0 },
				manifest: model.manifest,
			},
		};
	}
	const fontSize = layout.fontSize;
	const scale = layout.groupScale;
	const paddingX = Math.max(0, config.paddingX * scale);
	const paddingY = Math.max(0, config.paddingY * scale);
	const maxWidth = (canvasSize.width * layout.widthPercent) / 100;
	const maxTextWidth = Math.max(1, maxWidth - paddingX * 2);
	const lineHeight = fontSize * config.lineHeight;
	const rowGap = fontSize * 0.08;
	const gap = fontSize * 0.32;

	ctx.save();
	ctx.font = `${config.fontWeight} ${fontSize}px ${resolveFontFamily(config.fontFamily)}, sans-serif`;
	ctx.textAlign = "left";
	ctx.textBaseline = "middle";

	const lines = buildLines({ ctx, words, config, maxWidth: maxTextWidth, fontSize });
	const lineWidths = lines.map((line) => measureLine({ ctx, line, fontSize }));
	const contentWidth = Math.max(1, ...lineWidths);
	const boxWidth =
		config.backgroundFit === "fill" ? maxWidth : Math.min(maxWidth, contentWidth + paddingX * 2);
	const contentHeight =
		lines.length * lineHeight + Math.max(0, lines.length - 1) * rowGap;
	const boxHeight = contentHeight + paddingY * 2;
	const centerX = (layout.xPercent / 100) * canvasSize.width;
	const centerY = (layout.yPercent / 100) * canvasSize.height;
	const boxX = centerX - boxWidth / 2;
	const boxY = centerY - boxHeight / 2;

	ctx.translate(centerX, centerY);
	if (config.rotation) ctx.rotate((config.rotation * Math.PI) / 180);
	ctx.translate(-centerX, -centerY);

	if (config.backgroundEnabled) {
		ctx.fillStyle = backgroundRgba(config);
		roundedRect({
			ctx,
			x: boxX,
			y: boxY,
			width: boxWidth,
			height: boxHeight,
			radius: Math.max(0, config.borderRadius * scale),
		});
		ctx.fill();
	}

	if (config.backgroundBorderEnabled && config.backgroundBorderWidth > 0) {
		ctx.strokeStyle = config.backgroundBorderColor;
		ctx.lineWidth = config.backgroundBorderWidth * scale;
		roundedRect({
			ctx,
			x: boxX,
			y: boxY,
			width: boxWidth,
			height: boxHeight,
			radius: Math.max(0, config.borderRadius * scale),
		});
		ctx.stroke();
	}

	const shadow = config.textShadowEnabled
		? directionalShadow(
				config.textShadowColor,
				config.textShadowOpacity,
				config.textShadowDistance,
				config.textShadowBlur,
				config.textShadowAngle,
			)
		: "";
	ctx.shadowColor = "transparent";

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const line = lines[lineIndex];
		const lineWidth = lineWidths[lineIndex] ?? 0;
		let x =
			config.alignment === "left"
				? boxX + paddingX
				: config.alignment === "right"
					? boxX + boxWidth - paddingX - lineWidth
					: centerX - lineWidth / 2;
		const y =
			boxY + paddingY + lineHeight / 2 + lineIndex * (lineHeight + rowGap);

		for (const word of line) {
			const text = tokenText(word);
			const active = activeIds.has(word.id);
			const wordWidth = ctx.measureText(text).width;
			const fillStyle = active ? config.activeWordColor : config.textColor;

			if (shadow) {
				const parts = /(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+(.+)/.exec(shadow);
				if (parts) {
					ctx.shadowOffsetX = Number(parts[1]);
					ctx.shadowOffsetY = Number(parts[2]);
					ctx.shadowBlur = Number(parts[3]);
					ctx.shadowColor = parts[4] ?? "transparent";
				}
			}
			drawTextWithOptionalStroke({
				ctx,
				text,
				x,
				y,
				config,
				fillStyle,
				scale,
			});
			ctx.shadowColor = "transparent";
			x += wordWidth + gap;
		}
	}

	ctx.restore();
	return {
		debug: {
			rendererPath: "rendered_capinsta_wysiwyg",
			rendererStrategy: "word_highlight_box",
			clipId: renderData.clipId,
			clipText: renderData.clipText,
			presetId: renderData.captionStyle.presetId,
			activeWordIds,
			activeWordColor: config.activeWordColor,
			fontSize,
			box: { x: boxX, y: boxY, width: boxWidth, height: boxHeight },
			manifest: {
				...model.manifest,
				finalFontSize: fontSize,
				finalPosition: { xPercent: layout.xPercent, yPercent: layout.yPercent },
				finalBackgroundBox: {
					widthPercent: layout.widthPercent,
					heightPercent: layout.maxHeightPercent ?? null,
				},
			},
		},
	};
}

export function renderCapinstaWysiwygExportCaption({
	ctx,
	renderData,
	activeWordIds,
	timeSeconds,
	canvasSize,
}: {
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
	renderData: CapinstaTextRenderData;
	activeWordIds: string[];
	timeSeconds?: number;
	canvasSize: CaptionCanvasSize;
}): CapinstaWysiwygExportResult {
	const resolvedTimeSeconds =
		typeof timeSeconds === "number"
			? timeSeconds
			: renderData.words.find((word) => activeWordIds.includes(word.id))?.start ??
				renderData.words[0]?.start ??
				0;
	const presetId = renderData.captionStyle.presetId;
	if (presetId === "kinetic_fade") {
		return drawInlinePresetCaption({
			ctx,
			renderData,
			activeWordIds,
			timeSeconds: resolvedTimeSeconds,
			canvasSize,
			strategy: "kinetic_fade",
		});
	}
	if (presetId === "attention_punch") {
		return drawInlinePresetCaption({
			ctx,
			renderData,
			activeWordIds,
			timeSeconds: resolvedTimeSeconds,
			canvasSize,
			strategy: "attention_punch",
		});
	}
	if (presetId === "mrbeast_style") {
		return drawInlinePresetCaption({
			ctx,
			renderData,
			activeWordIds,
			timeSeconds: resolvedTimeSeconds,
			canvasSize,
			strategy: "mrbeast_style",
		});
	}
	if (presetId === "dynamic_punch") {
		return drawInlinePresetCaption({
			ctx,
			renderData,
			activeWordIds,
			timeSeconds: resolvedTimeSeconds,
			canvasSize,
			strategy: "dynamic_punch",
		});
	}
	if (presetId === "apple_cinematic") {
		return drawInlinePresetCaption({
			ctx,
			renderData,
			activeWordIds,
			timeSeconds: resolvedTimeSeconds,
			canvasSize,
			strategy: "apple_cinematic",
		});
	}
	if (presetId === "modern_minimalist_lockup") {
		return drawEditorialLockupCaption({
			ctx,
			renderData,
			activeWordIds,
			timeSeconds: resolvedTimeSeconds,
			canvasSize,
		});
	}
	return drawWordHighlightBoxCaption({
		ctx,
		renderData,
		activeWordIds,
		canvasSize,
	});
}
