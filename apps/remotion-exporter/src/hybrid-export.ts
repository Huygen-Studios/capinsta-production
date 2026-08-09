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

export type HybridOverlayTransport = "png" | "prores";
export type HybridOverlayMode = "full-rate" | "ordinary-held-sparse";

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
	resources: ResourceUsageSummary;
	verification: OutputVerification;
};

function hasOverlay(props: CapInstaRemotionPropsV1) {
	return Boolean(props.captions?.document.clips.length);
}

function runFfmpeg(args: string[], setChild: (child: ChildProcess | null) => void) {
	return new Promise<void>((resolvePromise, reject) => {
		const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
		setChild(child);
		let stderr = "";
		child.stderr?.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-16_000); });
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			setChild(null);
			if (code === 0) resolvePromise();
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
			browser = await openBrowser("chrome", { logLevel: "warn", chromiumOptions: { enableMultiProcessOnLinux: true } });
			const selectStarted = performance.now();
			const composition = await selectComposition({ serveUrl, id: REMOTION_OVERLAY_COMPOSITION_ID, inputProps: props, puppeteerInstance: browser, logLevel: "warn" });
			selectCompositionSeconds = (performance.now() - selectStarted) / 1000;
			const overlayStarted = performance.now();
			if (overlayTransport === "png") {
				const sparsePlan = overlayMode === "ordinary-held-sparse" ? planOrdinaryHeldOverlay(props) : null;
				const statesDirectory = sparsePlan ? resolve(temporaryDirectory, "states") : temporaryDirectory;
				await mkdir(statesDirectory, { recursive: true });
				await renderFrames({
					serveUrl, composition, inputProps: props, outputDir: statesDirectory,
					imageFormat: "png", imageSequencePattern: "overlay-[frame].[ext]",
					frames: sparsePlan?.renderFrames,
					concurrency, puppeteerInstance: browser, cancelSignal, muted: true, logLevel: "warn",
					onStart: ({ frameCount, resolvedConcurrency }) => console.log(JSON.stringify({ event: "hybrid_overlay_start", frameCount, resolvedConcurrency, transport: "png" })),
					onFrameUpdate: () => undefined,
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
		await runFfmpeg(buildHybridFfmpegArgs({ props, base, sourceFiles, overlay: transport, output }), (active) => { child = active; });
		const ffmpegSeconds = (performance.now() - ffmpegStarted) / 1000;
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
	} });
	if (!values.props || !values.output) throw new Error("Usage: bun run hybrid --props <json> --output <mp4> [--base video|solidColor]");
	const props = validateRemotionProps(JSON.parse(await readFile(resolve(values.props), "utf8")));
	const sourceFiles = new Map(props.media.sources.map((source) => [source.id, resolve(GENERATED_DIR, basename(new URL(source.url, "http://localhost").pathname))]));
	await exportHybrid({
		props,
		base: values.base === "solidColor" ? { type: "solidColor", color: values.color } : { type: "video" },
		sourceFiles,
		output: resolve(values.output),
		serveUrl: values.bundle ? resolve(values.bundle) : BUNDLE_DIR,
		overlayTransport: values.transport === "prores" ? "prores" : "png",
		overlayMode: values.sparse ? "ordinary-held-sparse" : "full-rate",
		concurrency: Number(values.concurrency) || 1,
		keepOverlay: values.keepOverlay,
	});
}

if (import.meta.main) main().catch((error) => {
	console.error(JSON.stringify({ event: "hybrid_export_error", message: error instanceof Error ? error.message : String(error) }));
	process.exitCode = 1;
});
