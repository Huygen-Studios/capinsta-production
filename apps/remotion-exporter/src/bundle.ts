import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { bundle } from "@remotion/bundler";
import { APP_DIR, BUNDLE_DIR, GENERATED_DIR, PUBLIC_DIR, REPO_DIR } from "./paths";

function preparePublicDir() {
	rmSync(PUBLIC_DIR, { recursive: true, force: true });
	mkdirSync(resolve(PUBLIC_DIR, "caption-fonts"), { recursive: true });
	const sourceFonts = resolve(REPO_DIR, "apps/web/public/caption-fonts");
	for (const directory of ["Poppins Font family", "Montserrat fotn family", "tactic font family"]) {
		cpSync(resolve(sourceFonts, directory), resolve(PUBLIC_DIR, "caption-fonts", directory), { recursive: true });
	}
	const fixture = resolve(GENERATED_DIR, "moving-source-30s.mp4");
	mkdirSync(resolve(PUBLIC_DIR, "remotion-fixtures"), { recursive: true });
	if (existsSync(fixture)) {
		cpSync(fixture, resolve(PUBLIC_DIR, "remotion-fixtures/moving-source-30s.mp4"));
	}
}

export async function buildBundle() {
	preparePublicDir();
	rmSync(BUNDLE_DIR, { recursive: true, force: true });
	const started = performance.now();
	const serveUrl = await bundle({
		entryPoint: resolve(APP_DIR, "src/index.ts"),
		outDir: BUNDLE_DIR,
		publicDir: null,
		enableCaching: true,
		webpackOverride: (configuration) => ({
			...configuration,
			resolve: {
				...configuration.resolve,
				alias: { ...configuration.resolve?.alias, "@": resolve(REPO_DIR, "apps/web/src") },
			},
		}),
		onProgress: (progress) => {
			const percent = Math.round(progress);
			if (percent % 20 === 0) console.error(JSON.stringify({ event: "remotion_bundle_progress", progress: percent / 100 }));
		},
	});
	cpSync(PUBLIC_DIR, BUNDLE_DIR, { recursive: true });
	const bundleBuildSeconds = (performance.now() - started) / 1000;
	console.log(JSON.stringify({ event: "remotion_bundle_complete", serveUrl, bundleBuildSeconds }));
	return { serveUrl, bundleBuildSeconds };
}

if (import.meta.main) await buildBundle();
