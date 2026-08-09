import { cpus, freemem, platform, release, totalmem } from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertSafeBenchmarkEnvironment } from "./benchmark-environment";
import { validateRemotionProps } from "./contracts";
import { exportHybrid } from "./hybrid-export";
import type { HybridBaseVisual } from "./hybrid-ffmpeg";
import { APP_DIR, BUNDLE_DIR, GENERATED_DIR } from "./paths";

const resultsPath = resolve(APP_DIR, "benchmark-results/hybrid-phase.json");
const artifactsDirectory = resolve(APP_DIR, "artifacts/hybrid-matrix");
const sourceFiles = new Map([["moving-source", resolve(GENERATED_DIR, "moving-source-30s.mp4")]]);

const cases: Array<{ name: string; fixture: string; base: HybridBaseVisual }> = [
	{ name: "video-ordinary", fixture: "ordinary-captions", base: { type: "video" } },
	{ name: "video-premium", fixture: "premium-captions", base: { type: "video" } },
	{ name: "video-no-overlay", fixture: "source-only", base: { type: "video" } },
	{ name: "solid-black-ordinary", fixture: "ordinary-captions", base: { type: "solidColor", color: "#000000" } },
	{ name: "solid-custom-premium", fixture: "premium-captions", base: { type: "solidColor", color: "#D02090" } },
	{ name: "solid-dark-no-overlay", fixture: "source-only", base: { type: "solidColor", color: "#18233A" } },
];

async function main() {
	assertSafeBenchmarkEnvironment();
	await mkdir(artifactsDirectory, { recursive: true });
	await mkdir(resolve(APP_DIR, "benchmark-results"), { recursive: true });
	const report = {
		schemaVersion: 1,
		phase: "isolated-remotion-hybrid-full-rate",
		status: "running",
		startedAt: new Date().toISOString(),
		isolation: { capinstaEnv: process.env.CAPINSTA_ENV, benchmarkRoot: process.env.CAPINSTA_BENCHMARK_ROOT, productionDatabaseUsed: false, remoteStorageUsed: false, cleanupAndRetentionStarted: false },
		host: { platform: platform(), release: release(), node: process.version, cpuModel: cpus()[0]?.model ?? "unknown", logicalCpuCount: cpus().length, totalMemoryBytes: totalmem(), freeMemoryBytesAtStart: freemem() },
		configuration: { resolution: "1080x1920", fps: 30, durationSeconds: 30, timelineFrames: 900, overlayMode: "full-rate", overlayTransport: "PNG sequence", overlayConcurrency: 4, finalCodec: "h264", finalPixelFormat: "yuv420p" },
		fullFrameReference: { variant: "png-c1-veryfast-cache512-new", renderMediaSeconds: 99.4486551, totalSeconds: 101.4399153, source: "performance-phase2.json" },
		alphaTransportTrial4Seconds: {
			png: { overlayRenderSeconds: 10.3471841, ffmpegSeconds: 2.6030921, totalSeconds: 13.7164597, bytes: 6_586_484 },
			prores4444: { overlayRenderSeconds: 21.7656911, ffmpegSeconds: 2.1635834, totalSeconds: 24.8020338, bytes: 8_651_315 },
		},
		matrix: [] as Array<Record<string, unknown>>,
	};
	const persist = () => writeFile(resultsPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	await persist();
	for (const entry of cases) {
		const props = validateRemotionProps(JSON.parse(await readFile(resolve(GENERATED_DIR, `${entry.fixture}.json`), "utf8")));
		console.log(JSON.stringify({ event: "hybrid_matrix_case_start", case: entry.name }));
		const result = await exportHybrid({ props, base: entry.base, sourceFiles, output: resolve(artifactsDirectory, `${entry.name}.mp4`), serveUrl: BUNDLE_DIR, concurrency: 4 });
		report.matrix.push({ case: entry.name, fixture: entry.fixture, base: entry.base, timelineFrames: result.frames, ...result });
		await persist();
	}
	report.status = "complete";
	Object.assign(report, { completedAt: new Date().toISOString() });
	await persist();
	console.log(JSON.stringify({ event: "hybrid_matrix_complete", resultsPath }));
}

if (import.meta.main) main().catch((error) => {
	console.error(JSON.stringify({ event: "hybrid_matrix_error", message: error instanceof Error ? error.message : String(error) }));
	process.exitCode = 1;
});
