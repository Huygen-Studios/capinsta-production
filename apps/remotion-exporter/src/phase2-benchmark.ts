import { cpus, freemem, platform, release, totalmem } from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openBrowser, type HeadlessBrowser } from "@remotion/renderer";
import { assertSafeBenchmarkEnvironment } from "./benchmark-environment";
import { buildBundle } from "./bundle";
import { validateRemotionProps, type CapInstaRemotionPropsV1 } from "./contracts";
import { APP_DIR, GENERATED_DIR } from "./paths";
import { renderCapInsta, type RenderResult } from "./render";

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;
const resultsPath = resolve(APP_DIR, "benchmark-results/performance-phase2.json");
const artifactsDir = resolve(APP_DIR, "artifacts/performance-phase2");

type Variant = {
	name: string;
	imageFormat: "jpeg" | "png";
	concurrency: 1 | 2;
	x264Preset: "veryfast" | "superfast";
	mediaCacheSizeInBytes: number;
	browser: "new" | "shared";
};

const matrix: Variant[] = [
	{ name: "png-c1-veryfast-cache512-new", imageFormat: "png", concurrency: 1, x264Preset: "veryfast", mediaCacheSizeInBytes: 512 * MiB, browser: "new" },
	{ name: "png-c1-veryfast-cache512-reuse1", imageFormat: "png", concurrency: 1, x264Preset: "veryfast", mediaCacheSizeInBytes: 512 * MiB, browser: "shared" },
	{ name: "png-c1-veryfast-cache512-reuse2", imageFormat: "png", concurrency: 1, x264Preset: "veryfast", mediaCacheSizeInBytes: 512 * MiB, browser: "shared" },
	{ name: "png-c1-veryfast-cache512-reuse3", imageFormat: "png", concurrency: 1, x264Preset: "veryfast", mediaCacheSizeInBytes: 512 * MiB, browser: "shared" },
	{ name: "jpeg80-c1-veryfast-cache512", imageFormat: "jpeg", concurrency: 1, x264Preset: "veryfast", mediaCacheSizeInBytes: 512 * MiB, browser: "shared" },
	{ name: "png-c2-veryfast-cache512", imageFormat: "png", concurrency: 2, x264Preset: "veryfast", mediaCacheSizeInBytes: 512 * MiB, browser: "shared" },
	{ name: "png-c2-superfast-cache512", imageFormat: "png", concurrency: 2, x264Preset: "superfast", mediaCacheSizeInBytes: 512 * MiB, browser: "shared" },
	{ name: "png-c2-veryfast-cache1024", imageFormat: "png", concurrency: 2, x264Preset: "veryfast", mediaCacheSizeInBytes: 1024 * MiB, browser: "shared" },
	{ name: "png-c2-veryfast-cache2048", imageFormat: "png", concurrency: 2, x264Preset: "veryfast", mediaCacheSizeInBytes: 2048 * MiB, browser: "shared" },
];

async function fixture(name: string) {
	return validateRemotionProps(JSON.parse(await readFile(resolve(GENERATED_DIR, `${name}.json`), "utf8")));
}

async function runVariant(variant: Variant, props: CapInstaRemotionPropsV1, browser?: HeadlessBrowser): Promise<RenderResult & { success: true; variant: string; fixture: string; mediaTransport: string; browserMode: "new" | "shared"; bundleReuse: true }> {
	return {
		success: true,
		variant: variant.name,
		fixture: props.timeline.edl.outputDurationMs === 30_000 ? "ordinary-captions" : "profile",
		mediaTransport: "bundle-local-http",
		browserMode: variant.browser,
		bundleReuse: true,
		...(await renderCapInsta({
			props,
			output: resolve(artifactsDir, `${variant.name}.mp4`),
			concurrency: variant.concurrency,
			x264Preset: variant.x264Preset,
			imageFormat: variant.imageFormat,
			jpegQuality: 80,
			mediaCacheSizeInBytes: variant.mediaCacheSizeInBytes,
			benchmarkAllowYuvj420p: variant.imageFormat === "jpeg",
			browser,
		})),
	};
}

async function main() {
	assertSafeBenchmarkEnvironment();
	await mkdir(artifactsDir, { recursive: true });
	await mkdir(resolve(APP_DIR, "benchmark-results"), { recursive: true });
	const packageJson = JSON.parse(await readFile(resolve(APP_DIR, "package.json"), "utf8"));
	const report: Record<string, unknown> & { matrix: Array<RenderResult & { variant: string; browserMode: "new" | "shared" }>; profiles: Array<Record<string, unknown>> } = {
		schemaVersion: 1,
		phase: "remotion-export-performance-isolation-phase2",
		startedAt: new Date().toISOString(),
		status: "running",
		isolation: {
			capinstaEnv: process.env.CAPINSTA_ENV,
			benchmarkRoot: process.env.CAPINSTA_BENCHMARK_ROOT,
			externalMutationOverride: false,
			productionBackendStarted: false,
			productionDatabaseUsed: false,
			remoteStorageUsed: false,
			cleanupAndRetentionStarted: false,
		},
		host: {
			platform: platform(), release: release(), node: process.version,
			cpuModel: cpus()[0]?.model ?? "unknown", logicalCpuCount: cpus().length,
			totalMemoryBytes: totalmem(), freeMemoryBytesAtStart: freemem(),
		},
		versions: {
			remotion: packageJson.dependencies.remotion,
			renderer: packageJson.dependencies["@remotion/renderer"],
		},
		qualityPolicy: { codec: "h264", pixelFormat: "yuv420p", crf: 23, jpegQuality: 80, audioRequired: true },
		phase1Reference: {
			fixture: "representative-180s", wallClockSeconds: 595.602, outputBytes: 203_850_456,
			peakProcessTreeWorkingSetBytes: Math.round(2488.6 * MiB), peakHostCpuPercent: 45.9,
			note: "Measured isolated phase-1 PNG, concurrency 1, x264 veryfast reference.",
		},
		matrix: [], profiles: [],
	};
	const persist = async () => writeFile(resultsPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	await persist();
	const bundle = await buildBundle();
	report.bundle = bundle;
	await persist();
	const ordinary = await fixture("ordinary-captions");
	const sharedBrowser = await openBrowser("chrome", { logLevel: "warn", chromiumOptions: { enableMultiProcessOnLinux: true } });
	try {
		for (const variant of matrix) {
			console.log(JSON.stringify({ event: "phase2_variant_start", variant: variant.name }));
			const result = await runVariant(variant, ordinary, variant.browser === "shared" ? sharedBrowser : undefined);
			report.matrix.push(result);
			await persist();
		}
		const selected = report.matrix.filter((result) => result.verification.pixelFormatContractValid).sort((a, b) => a.timings.renderMediaWallClockSeconds - b.timings.renderMediaWallClockSeconds)[0];
		report.selection = {
			fromVariant: selected.variant,
			settings: selected.settings,
			reason: "Fastest verified 30-second matrix result; exact dimensions, FPS, duration, H.264, yuv420p, and audio were enforced.",
		};
		for (const profileName of ["source-only", "premium-skyline_italic"]) {
			const props = await fixture(profileName);
			const profileVariant: Variant = { ...selected.settings, name: `profile-${profileName}`, browser: "shared", concurrency: Number(selected.settings.requestedConcurrency) === 2 ? 2 : 1 };
			const result = await runVariant(profileVariant, props, sharedBrowser);
			report.profiles.push({ ...result, fixture: profileName });
			await persist();
		}
		const finalProps = await fixture("representative-180s");
		const finalBrowserMode = selected.browserMode === "new" ? "new" : "shared";
		const finalVariant: Variant = { ...selected.settings, name: "selected-representative-180s", browser: finalBrowserMode, concurrency: Number(selected.settings.requestedConcurrency) === 2 ? 2 : 1 };
		report.final180 = { ...(await runVariant(finalVariant, finalProps, finalBrowserMode === "shared" ? sharedBrowser : undefined)), fixture: "representative-180s" };
		report.status = "complete";
		report.completedAt = new Date().toISOString();
		await persist();
		console.log(JSON.stringify({ event: "phase2_benchmark_complete", resultsPath, selection: report.selection, final180: report.final180 }));
	} finally {
		await sharedBrowser.close({ silent: true });
	}
}

if (import.meta.main) main().catch((error) => {
	console.error(JSON.stringify({ event: "phase2_benchmark_error", message: error instanceof Error ? error.message : String(error) }));
	process.exitCode = 1;
});
