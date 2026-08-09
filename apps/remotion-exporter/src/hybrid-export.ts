import { existsSync } from "node:fs";
import { copyFile, link, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { makeCancelSignal, openBrowser, renderFrames, renderMedia, selectComposition } from "@remotion/renderer";
import { installCancellationHandlers } from "./cancellation";
import {
	REMOTION_OVERLAY_COMPOSITION_ID,
	metadataForProps,
	type CapInstaRemotionPropsV1,
	validateRemotionProps,
} from "./contracts";
import { buildHybridFfmpegArgs, type HybridBaseVisual, type OverlayTransport } from "./hybrid-ffmpeg";
import { APP_DIR, BUNDLE_DIR, GENERATED_DIR } from "./paths";
import { verifyOutput, type OutputVerification } from "./verify";
import { ResourceMonitor, type ResourceUsageSummary } from "./resource-monitor";
import { planOrdinaryHeldOverlay } from "./sparse-overlay";
import { assertSafeBenchmarkEnvironment } from "./benchmark-environment";

export type HybridOverlayTransport = "png" | "prores";
export type HybridOverlayMode = "full-rate" | "ordinary-held-sparse";
export type X264Preset = "faster" | "veryfast" | "superfast";

export type FfmpegMetrics = {
	userCpuSeconds: number | null;
	systemCpuSeconds: number | null;
	realSeconds: number | null;
	maxRssKiB: number | null;
	progress: { frame: number; fps: number; speed: number; outTimeSeconds: number };
};

export type HybridExportResult = {
	output: string;
	baseMode: HybridBaseVisual["type"];
	overlayTransport: HybridOverlayTransport | "bypassed";
	remotionInvoked: boolean;
	frames: number;
	timings: { selectCompositionSeconds: number; overlayRenderSeconds: number; ffmpegSeconds: number; totalSeconds: number };
	overlayBytes: number;
	overlayFileCount: number;
	overlayStates: number;
	settings: { concurrency: number; x264Preset: X264Preset; x264Threads: 1 | 2 | "auto"; seekInputs: boolean };
	ffmpeg: FfmpegMetrics;
	resources: ResourceUsageSummary;
	verification: OutputVerification;
};

function hasOverlay(props: CapInstaRemotionPropsV1) {
	return Boolean(props.captions?.document.clips.length);
}

function runFfmpeg(args: string[], setChild: (child: ChildProcess | null) => void, durationSeconds: number) {
	return new Promise<FfmpegMetrics>((resolvePromise, reject) => {
		const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
		setChild(child);
		let stderr = "";
		let progressBuffer = "";
		let lastReportedProgress = -1;
		const progress = { frame: 0, fps: 0, speed: 0, outTimeSeconds: 0 };
		child.stdout?.on("data", (chunk) => {
			progressBuffer += String(chunk);
			const lines = progressBuffer.split(/\r?\n/);
			progressBuffer = lines.pop() ?? "";
			for (const line of lines) {
				const [key, value] = line.split("=", 2);
				if (key === "frame") progress.frame = Number(value) || progress.frame;
				else if (key === "fps") progress.fps = Number(value) || progress.fps;
				else if (key === "speed") progress.speed = Number(value?.replace("x", "")) || progress.speed;
				else if (key === "out_time_us") progress.outTimeSeconds = (Number(value) || 0) / 1_000_000;
				if (key === "progress" || key === "out_time_us") {
					const percent = Math.max(55, Math.min(94, 55 + Math.floor((Math.min(durationSeconds, progress.outTimeSeconds) / Math.max(0.001, durationSeconds)) * 39)));
					if (percent >= lastReportedProgress + 5) {
						lastReportedProgress = percent;
						console.log(JSON.stringify({ event: "hybrid_progress", stage: "encoding", progress: percent, message: `Encoding video ${Math.round(progress.outTimeSeconds)}s / ${Math.round(durationSeconds)}s` }));
					}
				}
			}
		});
		child.stderr?.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-16_000); });
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			setChild(null);
			if (code === 0) {
				const benchmark = /bench:\s+utime=([0-9.]+)s\s+stime=([0-9.]+)s\s+rtime=([0-9.]+)s/.exec(stderr);
				const rss = /maxrss=([0-9]+)k?i?B/i.exec(stderr);
				resolvePromise({
					userCpuSeconds: benchmark ? Number(benchmark[1]) : null,
					systemCpuSeconds: benchmark ? Number(benchmark[2]) : null,
					realSeconds: benchmark ? Number(benchmark[3]) : null,
					maxRssKiB: rss ? Number(rss[1]) : null,
					progress,
				});
			}
			else reject(new Error(`ffmpeg exited ${code ?? signal}: ${stderr}`));
		});
	});
}

export async function exportHybrid({
	props: rawProps,
	base,
	sourceFiles,
	output,
	serveUrl = BUNDLE_DIR,
	overlayTransport = "png",
	overlayMode = "full-rate",
	concurrency = 1,
	x264Preset = "veryfast",
	x264Threads = "auto",
	seekInputs = false,
	keepOverlay = false,
	signal,
}: {
	props: CapInstaRemotionPropsV1;
	base: HybridBaseVisual;
	sourceFiles: ReadonlyMap<string, string>;
	output: string;
	serveUrl?: string;
	overlayTransport?: HybridOverlayTransport;
	overlayMode?: HybridOverlayMode;
	concurrency?: number;
	x264Preset?: X264Preset;
	x264Threads?: 1 | 2 | "auto";
	seekInputs?: boolean;
	keepOverlay?: boolean;
	signal?: AbortSignal;
}): Promise<HybridExportResult> {
	const props = validateRemotionProps(rawProps);
	const started = performance.now();
	const overlayRequired = hasOverlay(props);
	if (overlayRequired && !existsSync(serveUrl)) throw new Error(`Bundle not found at ${serveUrl}; run bun run bundle first`);
	for (const source of props.media.sources) {
		if (base.type === "solidColor" && (!source.hasAudio || source.muted)) continue;
		const sourcePath = sourceFiles.get(source.id);
		if (!sourcePath || !existsSync(sourcePath)) throw new Error(`Missing local source file ${source.id}`);
	}
	await mkdir(dirname(output), { recursive: true });
	const temporaryRoot = resolve(tmpdir(), "capinsta-remotion-overlay");
	await mkdir(temporaryRoot, { recursive: true });
	const temporaryDirectory = await mkdtemp(resolve(temporaryRoot, "export-"));
	const { cancelSignal, cancel } = makeCancelSignal();
	let child: ChildProcess | null = null;
	const cancelAll = () => {
		cancel();
		child?.kill("SIGTERM");
	};
	const removeHandlers = installCancellationHandlers(cancelAll);
	signal?.addEventListener("abort", cancelAll, { once: true });
	let browser: Awaited<ReturnType<typeof openBrowser>> | null = null;
	let selectCompositionSeconds = 0;
	let overlayRenderSeconds = 0;
	let overlayBytes = 0;
	let overlayFileCount = 0;
	let transport: OverlayTransport = { type: "none" };
	const resourceMonitor = new ResourceMonitor();
	await resourceMonitor.start(5_000);
	let resources: ResourceUsageSummary | null = null;
	try {
		if (overlayRequired) {
			console.log(JSON.stringify({ event: "hybrid_progress", stage: "rendering_captions", progress: 10, message: "Starting Remotion caption render" }));
			browser = await openBrowser("chrome", { logLevel: "warn", chromiumOptions: { enableMultiProcessOnLinux: true } });
			const selectStarted = performance.now();
			const composition = await selectComposition({ serveUrl, id: REMOTION_OVERLAY_COMPOSITION_ID, inputProps: props, puppeteerInstance: browser, logLevel: "warn" });
			selectCompositionSeconds = (performance.now() - selectStarted) / 1000;
			const overlayStarted = performance.now();
			if (overlayTransport === "png") {
				const sparsePlan = overlayMode === "ordinary-held-sparse" ? planOrdinaryHeldOverlay(props) : null;
				let lastOverlayProgress = 9;
				const statesDirectory = sparsePlan ? resolve(temporaryDirectory, "states") : temporaryDirectory;
				await mkdir(statesDirectory, { recursive: true });
				await renderFrames({
					serveUrl, composition, inputProps: props, outputDir: statesDirectory,
					imageFormat: "png", imageSequencePattern: "overlay-[frame].[ext]",
					frames: sparsePlan?.renderFrames,
					concurrency, puppeteerInstance: browser, cancelSignal, muted: true, logLevel: "warn",
					onStart: ({ frameCount, resolvedConcurrency }) => console.log(JSON.stringify({ event: "hybrid_overlay_start", frameCount, resolvedConcurrency, transport: "png" })),
					onFrameUpdate: (frame) => {
						const frameCount = metadataForProps(props).durationInFrames;
						const progress = Math.min(54, 10 + Math.floor(((frame + 1) / Math.max(1, frameCount)) * 44));
						if (progress >= lastOverlayProgress + 5) {
							lastOverlayProgress = progress;
							console.log(JSON.stringify({ event: "hybrid_progress", stage: "rendering_captions", progress, message: `Rendering captions ${frame + 1} / ${frameCount}` }));
						}
					},
				});
				const { durationInFrames } = metadataForProps(props);
				overlayFileCount = sparsePlan?.renderFrames.length ?? durationInFrames;
				const digits = String(durationInFrames - 1).length;
				if (sparsePlan) {
					const sequenceDirectory = resolve(temporaryDirectory, "sequence");
					await mkdir(sequenceDirectory);
					for (let frame = 0; frame < durationInFrames; frame++) {
						const source = resolve(statesDirectory, `overlay-${String(sparsePlan.sourceFrameForTimelineFrame[frame]).padStart(digits, "0")}.png`);
						const destination = resolve(sequenceDirectory, `overlay-${String(frame).padStart(digits, "0")}.png`);
						try { await link(source, destination); } catch { await copyFile(source, destination); }
					}
					transport = { type: "png", pattern: resolve(sequenceDirectory, `overlay-%0${digits}d.png`) };
				} else transport = { type: "png", pattern: resolve(temporaryDirectory, `overlay-%0${digits}d.png`) };
				for (const frame of sparsePlan?.renderFrames ?? Array.from({ length: durationInFrames }, (_, index) => index)) overlayBytes += (await stat(resolve(statesDirectory, `overlay-${String(frame).padStart(digits, "0")}.png`))).size;
			} else {
				const overlayPath = resolve(temporaryDirectory, "overlay.mov");
				await renderMedia({
					serveUrl, composition, inputProps: props, outputLocation: overlayPath,
					codec: "prores", proResProfile: "4444", pixelFormat: "yuva444p10le", imageFormat: "png",
					concurrency, puppeteerInstance: browser, cancelSignal, muted: true, overwrite: true, logLevel: "warn",
				});
				transport = { type: "prores", path: overlayPath };
				overlayBytes = (await stat(overlayPath)).size;
				overlayFileCount = 1;
			}
			overlayRenderSeconds = (performance.now() - overlayStarted) / 1000;
			await browser.close({ silent: true });
			browser = null;
		}

		const ffmpegStarted = performance.now();
		console.log(JSON.stringify({ event: "hybrid_progress", stage: "composing_video", progress: 55, message: "Composing video with FFmpeg" }));
		const ffmpeg = await runFfmpeg(buildHybridFfmpegArgs({ props, base, sourceFiles, overlay: transport, output, preset: x264Preset, threads: x264Threads === "auto" ? null : x264Threads, seekInputs }), (active) => { child = active; }, metadataForProps(props).durationInFrames / props.export.fps);
		const ffmpegSeconds = (performance.now() - ffmpegStarted) / 1000;
		console.log(JSON.stringify({ event: "hybrid_progress", stage: "verifying", progress: 95, message: "Verifying final MP4" }));
		const verification = await verifyOutput(output, props);
		resources = await resourceMonitor.stop();
		const result: HybridExportResult = {
			output,
			baseMode: base.type,
			overlayTransport: overlayRequired ? overlayTransport : "bypassed",
			remotionInvoked: overlayRequired,
			frames: metadataForProps(props).durationInFrames,
			timings: { selectCompositionSeconds, overlayRenderSeconds, ffmpegSeconds, totalSeconds: (performance.now() - started) / 1000 },
			overlayBytes,
			overlayFileCount,
			overlayStates: overlayFileCount,
			settings: { concurrency, x264Preset, x264Threads, seekInputs },
			ffmpeg,
			resources,
			verification,
		};
		console.log(JSON.stringify({ event: "hybrid_export_complete", ...result }));
		return result;
	} catch (error) {
		await rm(output, { force: true });
		if (signal?.aborted || /cancel/i.test(error instanceof Error ? error.message : String(error))) throw new Error("Hybrid export cancelled", { cause: error });
		throw error;
	} finally {
		if (!resources) await resourceMonitor.stop();
		removeHandlers();
		signal?.removeEventListener("abort", cancelAll);
		if (browser) await browser.close({ silent: true });
		if (!keepOverlay) await rm(temporaryDirectory, { recursive: true, force: true });
		else console.log(JSON.stringify({ event: "hybrid_overlay_preserved", directory: temporaryDirectory }));
	}
}

async function main() {
	const { values } = parseArgs({ options: {
		props: { type: "string" }, output: { type: "string" }, bundle: { type: "string" },
		base: { type: "string", default: "video" }, color: { type: "string", default: "#000000" },
		transport: { type: "string", default: "png" }, concurrency: { type: "string", default: "1" }, keepOverlay: { type: "boolean", default: false },
		sparse: { type: "boolean", default: false },
		preset: { type: "string", default: "veryfast" }, threads: { type: "string", default: "auto" }, seekInputs: { type: "boolean", default: false },
		source: { type: "string" }, sources: { type: "string" },
		benchmark: { type: "boolean", default: false },
	} });
	if (!values.props || !values.output) throw new Error("Usage: bun run hybrid --props <json> --output <mp4> [--base video|solidColor]");
	if (values.benchmark) assertSafeBenchmarkEnvironment();
	const props = validateRemotionProps(JSON.parse(await readFile(resolve(values.props), "utf8")));
	if (values.source && values.sources) throw new Error("Use either --source or --sources");
	if (values.source && props.media.sources.length !== 1) throw new Error("--source supports exactly one media source in this isolated CLI");
	const explicitSources = values.sources ? JSON.parse(await readFile(resolve(values.sources), "utf8")) as Record<string, string> : {};
	const sourceFiles = new Map(props.media.sources.map((source) => [source.id, values.source ? resolve(values.source) : explicitSources[source.id] ? resolve(explicitSources[source.id]) : resolve(GENERATED_DIR, basename(new URL(source.url, "http://localhost").pathname))]));
	await exportHybrid({
		props,
		base: values.base === "solidColor" ? { type: "solidColor", color: values.color } : { type: "video" },
		sourceFiles,
		output: resolve(values.output),
		serveUrl: values.bundle ? resolve(values.bundle) : BUNDLE_DIR,
		overlayTransport: values.transport === "prores" ? "prores" : "png",
		overlayMode: values.sparse ? "ordinary-held-sparse" : "full-rate",
		concurrency: Number(values.concurrency) || 1,
		x264Preset: values.preset === "faster" ? "faster" : values.preset === "superfast" ? "superfast" : "veryfast",
		x264Threads: values.threads === "1" ? 1 : values.threads === "2" ? 2 : "auto",
		seekInputs: values.seekInputs,
		keepOverlay: values.keepOverlay,
	});
}

if (import.meta.main) main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	const code = message.includes("OUTPUT_INVALID")
		? "EXPORT_OUTPUT_INVALID"
		: message.startsWith("ffmpeg exited")
			? "EXPORT_FFMPEG_FAILED"
			: "EXPORT_REMOTION_FAILED";
	console.error(JSON.stringify({ event: "hybrid_export_error", code, message }));
	process.exitCode = 1;
});
