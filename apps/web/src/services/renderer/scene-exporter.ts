import EventEmitter from "eventemitter3";

import {
	Output,
	Mp4OutputFormat,
	WebMOutputFormat,
	BufferTarget,
	CanvasSource,
	AudioBufferSource,
	QUALITY_LOW,
	QUALITY_MEDIUM,
	QUALITY_HIGH,
	QUALITY_VERY_HIGH,
} from "mediabunny";
import type { FrameRate } from "opencut-wasm";
import { mediaTimeToSeconds } from "opencut-wasm";
import { TICKS_PER_SECOND } from "@/wasm";
import { frameRateToFloat } from "@/fps/utils";
import type { RootNode } from "./nodes/root-node";
import type { ExportFormat, ExportQuality } from "@/export";
import { CanvasRenderer } from "./canvas-renderer";
import type { CapinstaExportOverlayHost } from "@/capinsta/export/capinsta-overlay-capture";
import {
	rasterizeOverlayToCanvas,
	CapinstaOverlayRasterizationError,
	type CapinstaRasterStats,
} from "@/capinsta/export/capinsta-overlay-capture";
import type { CapinstaRenderModel } from "@/capinsta/render/capinstaRenderModel";

type ExportParams = {
	width: number;
	height: number;
	fps: FrameRate;
	format: ExportFormat;
	quality: ExportQuality;
	shouldIncludeAudio?: boolean;
	audioBuffer?: AudioBuffer;
	/**
	 * OPTIONAL. If provided, the React overlay host is advanced to each frame's
	 * time and rasterized on top of the WASM-composited video frame BEFORE
	 * encoding. This makes the React DOM overlay (CapinstaActiveCaptionOverlay)
	 * the single visual caption renderer for the exported MP4 — pixel-identical
	 * to the editor preview.
	 */
	overlayHost?: CapinstaExportOverlayHost;
	/**
	 * OPTIONAL callback invoked for every export frame with the active caption
	 * state. The editor preview uses this to keep its overlay in sync with the
	 * export frame time (otherwise the preview overlay appears stuck).
	 */
	onOverlayFrame?: (info: {
		frameIndex: number;
		frameTimeSeconds: number;
		model: CapinstaRenderModel | null;
	}) => void;
};

export interface CapinstaExportOverlayReport {
	overlayHostMounted: boolean;
	overlayDomCount: number;
	overlayRect: { width: number; height: number } | null;
	captionFramesRasterized: number;
	framesWithActiveCaption: number;
	maxRasterPixels: number;
	minRasterPixelsOnActiveCaption: number;
	firstRasterError: string | null;
	compositedBeforeEncode: boolean;
}

const FRAME_LOG_INDICES = new Set([0, 30, 60, 90]);

const qualityMap = {
	fast: QUALITY_LOW,
	balanced: QUALITY_MEDIUM,
	low: QUALITY_LOW,
	medium: QUALITY_MEDIUM,
	high: QUALITY_HIGH,
	very_high: QUALITY_VERY_HIGH,
};

export type SceneExporterEvents = {
	progress: [progress: number];
	complete: [buffer: ArrayBuffer];
	error: [error: Error];
	cancelled: [];
};

export class SceneExporter extends EventEmitter<SceneExporterEvents> {
	private renderer: CanvasRenderer;
	private format: ExportFormat;
	private quality: ExportQuality;
	private shouldIncludeAudio: boolean;
	private audioBuffer?: AudioBuffer;
	private overlayHost?: CapinstaExportOverlayHost;
	private onOverlayFrame?: ExportParams["onOverlayFrame"];

	/** Last overlay burn-in report, populated by export(). */
	lastOverlayReport: CapinstaExportOverlayReport | null = null;

	private isCancelled = false;

	constructor({
		width,
		height,
		fps,
		format,
		quality,
		shouldIncludeAudio,
		audioBuffer,
		overlayHost,
		onOverlayFrame,
	}: ExportParams) {
		super();
		this.renderer = new CanvasRenderer({
			width,
			height,
			fps,
		});

		this.format = format;
		this.quality = quality;
		this.shouldIncludeAudio = shouldIncludeAudio ?? false;
		this.audioBuffer = audioBuffer;
		this.overlayHost = overlayHost;
		this.onOverlayFrame = onOverlayFrame;
	}

	cancel(): void {
		this.isCancelled = true;
	}

	async export({
		rootNode,
	}: {
		rootNode: RootNode;
	}): Promise<ArrayBuffer | null> {
		const fps = this.renderer.fps;
		const fpsFloat = frameRateToFloat(fps);
		const ticksPerFrame = Math.round(
			(TICKS_PER_SECOND * fps.denominator) / fps.numerator,
		);
		const frameCount = Math.floor(rootNode.duration / ticksPerFrame);

		const width = this.renderer.width;
		const height = this.renderer.height;
		const hasOverlay = !!this.overlayHost;

		// CRITICAL: the WASM compositor's output canvas is a WebGL canvas. Calling
		// getContext("2d") on it returns null, so we CANNOT draw the overlay onto
		// it directly. Instead, when an overlay host is present, we composite every
		// frame through an intermediate 2D canvas:
		//   1. renderer.render() → WASM canvas (video frame)
		//   2. drawImage(wasmCanvas) → compositeCanvas (2D)
		//   3. advance overlay + rasterize → compositeCanvas
		//   4. videoSource.add() reads compositeCanvas
		// When no overlay host is present we feed the WASM canvas directly to
		// preserve the original high-performance path.
		let compositeCanvas: HTMLCanvasElement | null = null;
		let compositeCtx: CanvasRenderingContext2D | null = null;
		if (hasOverlay) {
			compositeCanvas = document.createElement("canvas");
			compositeCanvas.width = width;
			compositeCanvas.height = height;
			compositeCtx = compositeCanvas.getContext("2d", {
				willReadFrequently: false,
			});
			if (!compositeCtx) {
				throw new Error(
					"CapInsta export requires a 2D canvas context for overlay compositing, " +
						"but getContext('2d') returned null.",
				);
			}
		}

		const encoderSourceCanvas: HTMLCanvasElement | OffscreenCanvas =
			compositeCanvas ?? this.renderer.getOutputCanvas();

		const outputFormat =
			this.format === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat();

		const output = new Output({
			format: outputFormat,
			target: new BufferTarget(),
		});

		const videoSource = new CanvasSource(encoderSourceCanvas, {
			codec: this.format === "webm" ? "vp9" : "avc",
			bitrate: qualityMap[this.quality],
		});

		output.addVideoTrack(videoSource, { frameRate: fpsFloat });

		let audioSource: AudioBufferSource | null = null;
		if (this.shouldIncludeAudio && this.audioBuffer) {
			let audioCodec: "aac" | "opus" = this.format === "webm" ? "opus" : "aac";

			if (audioCodec === "aac" && typeof AudioEncoder !== "undefined") {
				const { supported } = await AudioEncoder.isConfigSupported({
					codec: "mp4a.40.2",
					sampleRate: this.audioBuffer.sampleRate,
					numberOfChannels: this.audioBuffer.numberOfChannels,
					bitrate: 192000,
				});
				if (!supported) audioCodec = "opus";
			}

			audioSource = new AudioBufferSource({
				codec: audioCodec,
				bitrate: qualityMap[this.quality],
			});
			output.addAudioTrack(audioSource);
		}

		await output.start();

		if (audioSource && this.audioBuffer) {
			await audioSource.add(this.audioBuffer);
			audioSource.close();
		}

		// Overlay report accumulators (FIX P).
		const report: CapinstaExportOverlayReport = {
			overlayHostMounted: !!this.overlayHost,
			overlayDomCount: 0,
			overlayRect: null,
			captionFramesRasterized: 0,
			framesWithActiveCaption: 0,
			maxRasterPixels: 0,
			minRasterPixelsOnActiveCaption: Number.POSITIVE_INFINITY,
			firstRasterError: null,
			compositedBeforeEncode: !!this.overlayHost,
		};
		if (this.overlayHost) {
			const overlayEl = this.overlayHost.getOverlayElement();
			if (overlayEl) {
				const rect = overlayEl.getBoundingClientRect();
				report.overlayRect = { width: rect.width, height: rect.height };
				report.overlayDomCount = document.querySelectorAll(
					"[data-capinsta-export-overlay-host='true']",
				).length;
			}
		}

		const isDebug =
			typeof process !== "undefined" &&
			process.env.NEXT_PUBLIC_CAPINSTA_DEBUG === "true";
		const skipOverlay =
			typeof process !== "undefined" &&
			process.env.NEXT_PUBLIC_CAPINSTA_EXPORT_SKIP_OVERLAY === "true";
		const skipWasmCopy =
			typeof process !== "undefined" &&
			process.env.NEXT_PUBLIC_CAPINSTA_EXPORT_SKIP_WASM_COPY === "true";

		try {
			for (let i = 0; i < frameCount; i++) {
				if (this.isCancelled) {
					await output.cancel();
					this.emit("cancelled");
					return null;
				}

				const timeTicks = i * ticksPerFrame;
				const timeSeconds = mediaTimeToSeconds({ time: timeTicks });

				// (a) Render the video/media frame onto the WASM canvas.
				await this.renderer.render({ node: rootNode, time: timeTicks });

				// (b)-(e) Overlay compositing pipeline. Order matters:
				//   b. advance React overlay to frameTime (flushSync inside host)
				//   c. rasterize React overlay → scratch pixels
				//   d. draw overlay onto encoder canvas (BEFORE videoSource.add)
				//   e. videoSource.add() captures the composited frame
				if (
					this.overlayHost &&
					compositeCtx &&
					compositeCanvas &&
					!skipOverlay
				) {
					// First, blit the WASM-rendered video frame onto the composite canvas.
					if (!skipWasmCopy) {
						compositeCtx.clearRect(0, 0, width, height);
						compositeCtx.drawImage(
							this.renderer.getOutputCanvas(),
							0,
							0,
							width,
							height,
						);
						try {
							compositeCtx.getImageData(0, 0, 1, 1);
							if (isDebug && FRAME_LOG_INDICES.has(i)) {
								console.debug("[capinsta-export] WASM copy origin clean: YES");
							}
						} catch (e) {
							console.error(
								"[capinsta-export] Canvas tainted after drawing WASM frame",
								e,
							);
							throw new Error(
								"Failed to construct 'VideoFrame': Canvas tainted by WASM/WebGL video frame. A cross-origin media source was likely drawn without CORS.",
							);
						}
					}

					// (b) Advance the React overlay DOM to this frame's time.
					const model = await this.overlayHost.advanceToTime(timeSeconds);

					// Notify the preview so its overlay stays in sync with export time.
					this.onOverlayFrame?.({
						frameIndex: i,
						frameTimeSeconds: timeSeconds,
						model,
					});

					// (c)+(d) Rasterize overlay onto the composite canvas.
					if (model) {
						report.framesWithActiveCaption++;
						try {
							const stats: CapinstaRasterStats = await rasterizeOverlayToCanvas(
								{
									host: this.overlayHost,
									targetCtx: compositeCtx,
								},
							);
							if (stats.rasterized) {
								report.captionFramesRasterized++;
								if (stats.nonTransparentPixels >= 0) {
									report.maxRasterPixels = Math.max(
										report.maxRasterPixels,
										stats.nonTransparentPixels,
									);
									report.minRasterPixelsOnActiveCaption = Math.min(
										report.minRasterPixelsOnActiveCaption,
										stats.nonTransparentPixels,
									);
								}
							}
							// Fail-fast: caption was active but rasterization produced
							// ZERO non-transparent pixels. This is the burn-in bug —
							// surface it instead of silently shipping an MP4 with no
							// captions.
							if (
								stats.nonTransparentPixels === 0 &&
								!process.env.NEXT_PUBLIC_CAPINSTA_EXPORT_DEBUG_BOX
							) {
								throw new CapinstaOverlayRasterizationError(
									`CapInsta overlay rasterized 0 non-transparent pixels on ` +
										`frame ${i} (time ${timeSeconds.toFixed(3)}s) even though ` +
										`a caption clip is active (clipId=${model.clip.id}, ` +
										`text="${model.text}"). The React overlay DOM did not ` +
										`produce visible pixels — burn-in failed.`,
									{
										frameIndex: i,
										timeSeconds,
										clipId: model.clip.id,
										stats,
									},
								);
							}
						} catch (err) {
							if (!report.firstRasterError) {
								report.firstRasterError =
									err instanceof Error ? err.message : String(err);
							}
							throw err;
						}
					}

					// Frame sample logging at frames 0/30/60/90.
					if (isDebug && FRAME_LOG_INDICES.has(i)) {
						console.debug("[capinsta-export] frame sample", {
							frameIndex: i,
							frameTimeSeconds: timeSeconds,
							activeCaptionId: model?.clip.id ?? null,
							activeWordId: model?.activeWordId ?? null,
							activeCaptionText: model?.text ?? null,
							rasterized:
								report.captionFramesRasterized > 0
									? "yes"
									: "no-active-caption",
						});
					}

					try {
						compositeCtx.getImageData(0, 0, 1, 1);
						if (isDebug && FRAME_LOG_INDICES.has(i)) {
							console.debug(
								"[capinsta-export] Overlay rasterization origin clean: YES",
							);
						}
					} catch (e) {
						console.error(
							"[capinsta-export] Canvas tainted after drawing overlay",
							e,
						);
						throw new Error(
							"Failed to construct 'VideoFrame': Canvas tainted by React overlay rasterization. The overlay likely contains a cross-origin external font or image.",
						);
					}
				}

				// (e) Encode. CanvasSource captures the current canvas state.
				await videoSource.add(timeSeconds, 1 / fpsFloat);

				this.emit("progress", i / frameCount);
			}

			if (this.isCancelled) {
				await output.cancel();
				this.emit("cancelled");
				return null;
			}

			videoSource.close();
			await output.finalize();
			this.emit("progress", 1);
		} finally {
			if (Number.isFinite(report.minRasterPixelsOnActiveCaption)) {
				// keep value
			} else {
				report.minRasterPixelsOnActiveCaption = 0;
			}
			this.lastOverlayReport = report;
			if (isDebug) {
				console.debug("[capinsta-export] overlay report", report);
			}
		}

		const buffer = output.target.buffer;
		if (!buffer) {
			this.emit("error", new Error("Failed to export video"));
			return null;
		}

		this.emit("complete", buffer);
		return buffer;
	}
}
