import {
	Input,
	ALL_FORMATS,
	BlobSource,
	UrlSource,
	CanvasSink,
	type WrappedCanvas,
} from "mediabunny";

interface VideoSinkData {
	input: Input;
	sink: CanvasSink;
	iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null;
	currentFrame: WrappedCanvas | null;
	nextFrame: WrappedCanvas | null;
	lastTime: number;
	prefetching: boolean;
	prefetchPromise: Promise<void> | null;
}

export class VideoCache {
	private sinks = new Map<string, VideoSinkData>();
	private initPromises = new Map<string, Promise<void>>();
	private frameChain = new Map<string, Promise<unknown>>();
	private seekGenerations = new Map<string, number>();
	private materializedFrames = new Map<
		string,
		{
			source: OffscreenCanvas | HTMLCanvasElement;
			timestamp: number;
			frame: WrappedCanvas;
		}
	>();

	async getFrameAt({
		mediaId,
		file,
		url,
		time,
	}: {
		mediaId: string;
		file: File;
		url?: string;
		time: number;
	}): Promise<WrappedCanvas | null> {
		await this.ensureSink({ mediaId, file, url });

		const sinkData = this.sinks.get(mediaId);
		if (!sinkData) return null;

		const generation = (this.seekGenerations.get(mediaId) ?? 0) + 1;
		this.seekGenerations.set(mediaId, generation);

		const previous = this.frameChain.get(mediaId) ?? Promise.resolve();
		const current = previous.then(() => {
			if (this.seekGenerations.get(mediaId) !== generation) {
				return sinkData.currentFrame ?? null;
			}
			return this.resolveFrame({ sinkData, time });
		});
		this.frameChain.set(
			mediaId,
			current.catch(() => {}),
		);
		const decodedFrame = await current;
		const frame = decodedFrame
			? this.materializeFrame({ mediaId, frame: decodedFrame })
			: null;
		if (process.env.NEXT_PUBLIC_CAPINSTA_DEBUG === "true") {
			console.debug("[preview] Video frame resolved", {
				mediaId,
				requestedTime: time,
				frameTimestamp: frame?.timestamp,
				frameDuration: frame?.duration,
				width: frame?.canvas.width,
				height: frame?.canvas.height,
				hasFrame: Boolean(frame),
				pixelSample: frame
					? sampleCanvasPixels({
							canvas: frame.canvas,
							width: frame.canvas.width,
							height: frame.canvas.height,
						})
					: null,
			});
		}
		return frame;
	}

	private materializeFrame({
		mediaId,
		frame,
	}: {
		mediaId: string;
		frame: WrappedCanvas;
	}): WrappedCanvas {
		const cached = this.materializedFrames.get(mediaId);
		if (
			cached &&
			cached.source === frame.canvas &&
			cached.timestamp === frame.timestamp
		) {
			return cached.frame;
		}

		const canvas = new OffscreenCanvas(frame.canvas.width, frame.canvas.height);
		const context = canvas.getContext("2d");
		if (!context) {
			throw new Error("Failed to materialize decoded video frame");
		}
		context.drawImage(frame.canvas, 0, 0);

		const materializedFrame: WrappedCanvas = {
			...frame,
			canvas,
		};
		this.materializedFrames.set(mediaId, {
			source: frame.canvas,
			timestamp: frame.timestamp,
			frame: materializedFrame,
		});
		return materializedFrame;
	}

	private async resolveFrame({
		sinkData,
		time,
	}: {
		sinkData: VideoSinkData;
		time: number;
	}): Promise<WrappedCanvas | null> {
		if (sinkData.nextFrame && sinkData.nextFrame.timestamp <= time) {
			sinkData.currentFrame = sinkData.nextFrame;
			sinkData.nextFrame = null;
			this.startPrefetch({ sinkData });
		}

		if (
			sinkData.currentFrame &&
			this.isFrameValid({ frame: sinkData.currentFrame, time })
		) {
			if (!sinkData.nextFrame && !sinkData.prefetching) {
				this.startPrefetch({ sinkData });
			}
			return sinkData.currentFrame;
		}

		if (
			sinkData.iterator &&
			sinkData.currentFrame &&
			time >= sinkData.lastTime &&
			time < sinkData.lastTime + 2.0
		) {
			const frame = await this.iterateToTime({ sinkData, targetTime: time });
			if (frame) {
				if (!sinkData.nextFrame && !sinkData.prefetching) {
					this.startPrefetch({ sinkData });
				}
				return frame;
			}
		}

		const frame = await this.seekToTime({ sinkData, time });
		if (frame && !sinkData.nextFrame && !sinkData.prefetching) {
			this.startPrefetch({ sinkData });
		}
		return frame;
	}

	private isFrameValid({
		frame,
		time,
	}: {
		frame: WrappedCanvas;
		time: number;
	}): boolean {
		return time >= frame.timestamp && time < frame.timestamp + frame.duration;
	}
	private async iterateToTime({
		sinkData,
		targetTime,
	}: {
		sinkData: VideoSinkData;
		targetTime: number;
	}): Promise<WrappedCanvas | null> {
		if (!sinkData.iterator) return null;

		try {
			while (true) {
				// Wait for any pending prefetch to finish before touching iterator
				if (sinkData.prefetching && sinkData.prefetchPromise) {
					await sinkData.prefetchPromise;
				}

				// Check if the nextFrame (which might have just arrived) is what we need
				if (
					sinkData.nextFrame &&
					sinkData.nextFrame.timestamp <= targetTime + 0.05 // Tolerance
				) {
					sinkData.currentFrame = sinkData.nextFrame;
					sinkData.nextFrame = null;
				} else {
					const { value: frame, done } = await sinkData.iterator.next();

					if (done || !frame) break;

					sinkData.currentFrame = frame;
				}

				const frame = sinkData.currentFrame;
				if (!frame) break;

				sinkData.lastTime = frame.timestamp;

				if (this.isFrameValid({ frame, time: targetTime })) {
					return frame;
				}

				if (frame.timestamp > targetTime + 1.0) break;
			}
		} catch (error) {
			console.warn("Iterator failed, will restart:", error);
			sinkData.iterator = null;
		}

		return null;
	}
	private async seekToTime({
		sinkData,
		time,
	}: {
		sinkData: VideoSinkData;
		time: number;
	}): Promise<WrappedCanvas | null> {
		try {
			if (sinkData.prefetching && sinkData.prefetchPromise) {
				await sinkData.prefetchPromise;
			}

			if (sinkData.iterator) {
				await sinkData.iterator.return();
				sinkData.iterator = null;
			}

			sinkData.nextFrame = null;
			sinkData.iterator = sinkData.sink.canvases(time);
			sinkData.lastTime = time;

			// Fetch current frame
			const { value: frame } = await sinkData.iterator.next();

			if (frame) {
				sinkData.currentFrame = frame;
				this.startPrefetch({ sinkData });
				return frame;
			}
		} catch (error) {
			console.warn("Failed to seek video:", error);
		}

		return null;
	}

	private startPrefetch({ sinkData }: { sinkData: VideoSinkData }): void {
		if (sinkData.prefetching || !sinkData.iterator || sinkData.nextFrame) {
			return;
		}

		sinkData.prefetching = true;
		sinkData.prefetchPromise = this.prefetchNextFrame({ sinkData });
	}

	private async prefetchNextFrame({
		sinkData,
	}: {
		sinkData: VideoSinkData;
	}): Promise<void> {
		if (!sinkData.iterator) {
			sinkData.prefetching = false;
			sinkData.prefetchPromise = null;
			return;
		}

		try {
			const { value: frame, done } = await sinkData.iterator.next();

			if (done || !frame) {
				sinkData.prefetching = false;
				sinkData.prefetchPromise = null;
				return;
			}

			sinkData.nextFrame = frame;
			sinkData.prefetching = false;
			sinkData.prefetchPromise = null;
		} catch (error) {
			console.warn("Prefetch failed:", error);
			sinkData.prefetching = false;
			sinkData.prefetchPromise = null;
			sinkData.iterator = null;
		}
	}
	private async ensureSink({
		mediaId,
		file,
		url,
	}: {
		mediaId: string;
		file: File;
		url?: string;
	}): Promise<void> {
		if (this.sinks.has(mediaId)) return;

		if (this.initPromises.has(mediaId)) {
			await this.initPromises.get(mediaId);
			return;
		}

		const initPromise = this.initializeSink({ mediaId, file, url });
		this.initPromises.set(mediaId, initPromise);

		try {
			await initPromise;
		} finally {
			this.initPromises.delete(mediaId);
		}
	}
	private async initializeSink({
		mediaId,
		file,
		url,
	}: {
		mediaId: string;
		file: File;
		url?: string;
	}): Promise<void> {
		const input = new Input({
			source:
				file.size > 0
					? new BlobSource(file)
					: new UrlSource(url ?? "", {
							requestInit: { cache: "no-store", credentials: "omit" },
							maxCacheSize: 32 * 1024 * 1024,
						}),
			formats: ALL_FORMATS,
		});

		try {
			const videoTrack = await input.getPrimaryVideoTrack();
			if (!videoTrack) {
				throw new Error("No video track found");
			}

			const canDecode = await videoTrack.canDecode();
			if (!canDecode) {
				throw new Error("Video codec not supported for decoding");
			}
			if (process.env.NEXT_PUBLIC_CAPINSTA_DEBUG === "true") {
				console.debug("[preview] Video decoder initialized", {
					mediaId,
					fileName: file.name,
					fileType: file.type,
					fileSize: file.size,
				});
			}

			const sink = new CanvasSink(videoTrack, {
				poolSize: 3,
				fit: "contain",
			});

			this.sinks.set(mediaId, {
				input,
				sink,
				iterator: null,
				currentFrame: null,
				nextFrame: null,
				lastTime: -1,
				prefetching: false,
				prefetchPromise: null,
			});
		} catch (error) {
			input.dispose();
			console.error(`Failed to initialize video sink for ${mediaId}:`, error);
			throw error;
		}
	}

	clearVideo({ mediaId }: { mediaId: string }): void {
		const sinkData = this.sinks.get(mediaId);
		if (sinkData) {
			if (sinkData.iterator) {
				void sinkData.iterator.return();
			}

			sinkData.input.dispose();
			this.sinks.delete(mediaId);
		}

		this.initPromises.delete(mediaId);
		this.frameChain.delete(mediaId);
		this.seekGenerations.delete(mediaId);
	}

	clearAll(): void {
		for (const [mediaId] of this.sinks) {
			this.clearVideo({ mediaId });
		}
	}

	getStats() {
		return {
			totalSinks: this.sinks.size,
			activeSinks: Array.from(this.sinks.values()).filter((s) => s.iterator)
				.length,
			cachedFrames: Array.from(this.sinks.values()).filter(
				(s) => s.currentFrame,
			).length,
		};
	}
}

function sampleCanvasPixels({
	canvas,
	width,
	height,
}: {
	canvas: CanvasImageSource;
	width: number;
	height: number;
}): { averageRgb: [number, number, number]; opaquePixels: number } | null {
	try {
		const sampleSize = 8;
		const sampleCanvas = new OffscreenCanvas(sampleSize, sampleSize);
		const context = sampleCanvas.getContext("2d", {
			willReadFrequently: true,
		});
		if (!context) return null;

		context.drawImage(
			canvas,
			0,
			0,
			width,
			height,
			0,
			0,
			sampleSize,
			sampleSize,
		);
		const pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;
		let red = 0;
		let green = 0;
		let blue = 0;
		let opaquePixels = 0;

		for (let index = 0; index < pixels.length; index += 4) {
			red += pixels[index];
			green += pixels[index + 1];
			blue += pixels[index + 2];
			if (pixels[index + 3] > 0) opaquePixels++;
		}

		const pixelCount = pixels.length / 4;
		return {
			averageRgb: [
				Math.round(red / pixelCount),
				Math.round(green / pixelCount),
				Math.round(blue / pixelCount),
			],
			opaquePixels,
		};
	} catch (error) {
		console.warn("[preview] Failed to sample decoded video frame", error);
		return null;
	}
}

export const videoCache = new VideoCache();
