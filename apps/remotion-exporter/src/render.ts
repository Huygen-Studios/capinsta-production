import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import {
	makeCancelSignal,
	openBrowser,
	renderMedia,
	selectComposition,
	type HeadlessBrowser,
	type RenderMediaProgress,
	type SlowFrame,
} from "@remotion/renderer";
import {
	REMOTION_COMPOSITION_ID,
	qualityCrf,
	type CapInstaRemotionPropsV1,
	validateRemotionProps,
} from "./contracts";
import { BUNDLE_DIR } from "./paths";
import { ProgressSampler } from "./progress";
import { verifyOutput, type OutputVerification } from "./verify";
import { installCancellationHandlers } from "./cancellation";
import { ResourceMonitor, type ResourceUsageSummary } from "./resource-monitor";

export type RenderTimings = {
	mediaPrepareSeconds: number;
	mediaDownloadSeconds: number;
	mediaDownloadBytes: number;
	mediaDownloadCount: number;
	renderedDoneInSeconds: number | null;
	encodedDoneInSeconds: number | null;
	renderedFrames: number;
	encodedFrames: number;
	muxSeconds: number | null;
	renderMediaWallClockSeconds: number;
};

export type RenderResult = {
	output: string;
	browserStartupSeconds: number;
	selectCompositionSeconds: number;
	renderSeconds: number;
	totalWallClockSeconds: number;
	frames: number;
	resolvedConcurrency: number;
	parallelEncoding: boolean;
	settings: {
		crf: number;
		imageFormat: "jpeg" | "png";
		jpegQuality: number;
		x264Preset: "veryfast" | "superfast";
		requestedConcurrency: number | string;
		mediaCacheSizeInBytes: number;
		disallowParallelEncoding: boolean;
	};
	timings: RenderTimings;
	resources: ResourceUsageSummary;
	slowestFrames: SlowFrame[];
	verification: OutputVerification;
};

export class RemotionPrototypeError extends Error {
	constructor(public readonly code: "REMOTION_BUNDLE_FAILED" | "REMOTION_COMPOSITION_FAILED" | "SOURCE_MEDIA_FAILED" | "FONT_LOAD_FAILED" | "REMOTION_RENDER_FAILED" | "REMOTION_CANCELLED" | "OUTPUT_INVALID", cause: unknown) {
		super(cause instanceof Error ? cause.message : String(cause), { cause });
	}
}

function renderErrorCode(error: unknown): RemotionPrototypeError["code"] {
	const message = error instanceof Error ? error.message : String(error);
	if (/cancel/i.test(message)) return "REMOTION_CANCELLED";
	if (/font/i.test(message)) return "FONT_LOAD_FAILED";
	if (/Could not (?:load|read|download)|Failed to (?:fetch|load).*(?:video|media)|CORS|HTTP status/i.test(message)) return "SOURCE_MEDIA_FAILED";
	return "REMOTION_RENDER_FAILED";
}

export async function renderCapInsta({
	props,
	output,
	serveUrl = BUNDLE_DIR,
	concurrency = 1,
	x264Preset = "veryfast",
	imageFormat = "png",
	jpegQuality = 80,
	browser,
	mediaCacheSizeInBytes = 512 * 1024 * 1024,
	disallowParallelEncoding = false,
	benchmarkAllowYuvj420p = false,
}: {
	props: CapInstaRemotionPropsV1;
	output: string;
	serveUrl?: string;
	concurrency?: number | string;
	x264Preset?: "veryfast" | "superfast";
	imageFormat?: "jpeg" | "png";
	jpegQuality?: number;
	browser?: HeadlessBrowser;
	mediaCacheSizeInBytes?: number;
	disallowParallelEncoding?: boolean;
	benchmarkAllowYuvj420p?: boolean;
}): Promise<RenderResult> {
	if (!existsSync(serveUrl)) throw new RemotionPrototypeError("REMOTION_BUNDLE_FAILED", `Bundle not found at ${serveUrl}; run bun run bundle first`);
	const resourceMonitor = new ResourceMonitor();
	await resourceMonitor.start();
	const totalStarted = performance.now();
	let resources: ResourceUsageSummary | null = null;
	await mkdir(dirname(output), { recursive: true });
	const ownedBrowser = !browser;
	const browserStarted = performance.now();
	const activeBrowser = browser ?? await openBrowser("chrome", { logLevel: "warn", chromiumOptions: { enableMultiProcessOnLinux: true } });
	const browserStartupSeconds = ownedBrowser ? (performance.now() - browserStarted) / 1000 : 0;
	const { cancelSignal, cancel } = makeCancelSignal();
	const removeCancellationHandlers = installCancellationHandlers(cancel);
	let totalFrames = 0;
	let resolvedConcurrency = 0;
	let parallelEncoding = false;
	let renderMediaStarted = 0;
	let onStartAt = 0;
	let muxStartedAt = 0;
	let slowestFrames: SlowFrame[] = [];
	const progressState = { renderedDoneIn: null as number | null, encodedDoneIn: null as number | null, renderedFrames: 0, encodedFrames: 0 };
	let downloadStartedAt = 0;
	let downloadLastAt = 0;
	const downloads = new Map<string, number>();
	const sampler = new ProgressSampler(() => totalFrames);
	try {
		const selectStarted = performance.now();
		let composition;
		try {
			composition = await selectComposition({ serveUrl, id: REMOTION_COMPOSITION_ID, inputProps: props, puppeteerInstance: activeBrowser, mediaCacheSizeInBytes, logLevel: "warn" });
		} catch (error) {
			throw new RemotionPrototypeError("REMOTION_COMPOSITION_FAILED", error);
		}
		const selectCompositionSeconds = (performance.now() - selectStarted) / 1000;
		const renderStarted = performance.now();
		try {
			renderMediaStarted = performance.now();
			const mediaResult = await renderMedia({
				serveUrl,
				composition,
				inputProps: props,
				outputLocation: output,
				codec: "h264",
				imageFormat,
				jpegQuality,
				pixelFormat: "yuv420p",
				x264Preset,
				crf: qualityCrf[props.export.quality],
				concurrency,
				hardwareAcceleration: "disable",
				mediaCacheSizeInBytes,
				disallowParallelEncoding,
				puppeteerInstance: activeBrowser,
				cancelSignal,
				overwrite: true,
				logLevel: "warn",
				onStart: (start) => {
					onStartAt = performance.now();
					resolvedConcurrency = start.resolvedConcurrency;
					parallelEncoding = start.parallelEncoding;
					const { frameCount } = start;
					totalFrames = frameCount;
					console.log(JSON.stringify({ event: "remotion_render_start", totalFrames, resolvedConcurrency, parallelEncoding }));
				},
				onProgress: (progress) => {
					if (progress.renderedDoneIn !== null) progressState.renderedDoneIn = progress.renderedDoneIn;
					if (progress.encodedDoneIn !== null) progressState.encodedDoneIn = progress.encodedDoneIn;
					progressState.renderedFrames = Math.max(progressState.renderedFrames, progress.renderedFrames);
					progressState.encodedFrames = Math.max(progressState.encodedFrames, progress.encodedFrames);
					if (progress.stitchStage === "muxing" && !muxStartedAt) muxStartedAt = performance.now();
					if (sampler.shouldLog(progress)) console.log(JSON.stringify(sampler.convert(progress)));
				},
				onDownload: (src) => (progress) => {
					const now = performance.now();
					if (!downloadStartedAt) downloadStartedAt = now;
					downloadLastAt = now;
					downloads.set(src, Math.max(downloads.get(src) ?? 0, progress.downloaded));
				},
			});
			slowestFrames = mediaResult.slowestFrames;
		} catch (error) {
			throw new RemotionPrototypeError(renderErrorCode(error), error);
		}
		const renderCompletedAt = performance.now();
		const renderSeconds = (renderCompletedAt - renderStarted) / 1000;
		let verification;
		try {
			verification = await verifyOutput(output, props, { allowYuvj420p: benchmarkAllowYuvj420p });
		} catch (error) {
			throw new RemotionPrototypeError("OUTPUT_INVALID", error);
		}
		resources = await resourceMonitor.stop();
		const timings: RenderTimings = {
			mediaPrepareSeconds: onStartAt ? (onStartAt - renderMediaStarted) / 1000 : 0,
			mediaDownloadSeconds: downloadStartedAt ? (downloadLastAt - downloadStartedAt) / 1000 : 0,
			mediaDownloadBytes: [...downloads.values()].reduce((sum, bytes) => sum + bytes, 0),
			mediaDownloadCount: downloads.size,
			renderedDoneInSeconds: progressState.renderedDoneIn == null ? null : progressState.renderedDoneIn / 1000,
			encodedDoneInSeconds: progressState.encodedDoneIn == null ? null : progressState.encodedDoneIn / 1000,
			renderedFrames: progressState.renderedFrames,
			encodedFrames: progressState.encodedFrames,
			muxSeconds: muxStartedAt ? (renderCompletedAt - muxStartedAt) / 1000 : null,
			renderMediaWallClockSeconds: (renderCompletedAt - renderMediaStarted) / 1000,
		};
		const result: RenderResult = {
			output, browserStartupSeconds, selectCompositionSeconds, renderSeconds,
			totalWallClockSeconds: (performance.now() - totalStarted) / 1000,
			frames: totalFrames, resolvedConcurrency, parallelEncoding,
			settings: { crf: qualityCrf[props.export.quality], imageFormat, jpegQuality, x264Preset, requestedConcurrency: concurrency, mediaCacheSizeInBytes, disallowParallelEncoding },
			timings, resources, slowestFrames, verification,
		};
		console.log(JSON.stringify({ event: "remotion_render_complete", ...result }));
		return result;
	} finally {
		if (!resources) await resourceMonitor.stop();
		removeCancellationHandlers();
		if (ownedBrowser) await activeBrowser.close({ silent: true });
	}
}

async function main() {
	const { values } = parseArgs({ options: {
		props: { type: "string" }, output: { type: "string" }, bundle: { type: "string" },
		concurrency: { type: "string", default: "1" }, preset: { type: "string", default: "veryfast" },
		format: { type: "string", default: "png" }, cacheMiB: { type: "string", default: "512" },
		disallowParallelEncoding: { type: "boolean", default: false },
	} });
	if (!values.props || !values.output) throw new Error("Usage: bun run render --props <json> --output <mp4>");
	const propsPath = resolve(values.props);
	const props = validateRemotionProps(JSON.parse(await readFile(propsPath, "utf8")));
	await renderCapInsta({
		props,
		output: resolve(values.output),
		serveUrl: values.bundle ? resolve(values.bundle) : BUNDLE_DIR,
		concurrency: Number(values.concurrency) === 2 ? 2 : 1,
		x264Preset: values.preset === "superfast" ? "superfast" : "veryfast",
		imageFormat: values.format === "jpeg" ? "jpeg" : "png",
		mediaCacheSizeInBytes: Math.max(1, Number(values.cacheMiB)) * 1024 * 1024,
		disallowParallelEncoding: values.disallowParallelEncoding,
	});
}

if (import.meta.main) {
	main().catch((error) => {
		const code = error instanceof RemotionPrototypeError ? error.code : "REMOTION_RENDER_FAILED";
		console.error(JSON.stringify({ event: "remotion_render_error", code, message: error instanceof Error ? error.message : String(error) }));
		process.exitCode = 1;
	});
}
