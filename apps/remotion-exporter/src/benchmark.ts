import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openBrowser } from "@remotion/renderer";
import { validateRemotionProps } from "./contracts";
import { BUNDLE_DIR } from "./paths";
import { renderCapInsta } from "./render";
import { assertSafeBenchmarkEnvironment } from "./benchmark-environment";

async function main() {
	assertSafeBenchmarkEnvironment();
	const propsPath = process.argv[2];
	const outputDirectory = resolve(process.argv[3] ?? "artifacts/benchmark");
	if (!propsPath) throw new Error("Usage: bun run benchmark <props.json> [output-directory]");
	await mkdir(outputDirectory, { recursive: true });
	const props = validateRemotionProps(JSON.parse(await readFile(resolve(propsPath), "utf8")));
	const results = [];
	results.push({ variant: "new-browser-c1-veryfast", ...(await renderCapInsta({ props, output: resolve(outputDirectory, "new-browser-c1-veryfast.mp4"), concurrency: 1 })) });
	const browser = await openBrowser("chrome", { logLevel: "warn", chromiumOptions: { enableMultiProcessOnLinux: true } });
	try {
		for (const [concurrency, preset] of [[1, "veryfast"], [2, "veryfast"], [1, "superfast"]] as const) {
			const variant = `reused-browser-c${concurrency}-${preset}`;
			results.push({ variant, ...(await renderCapInsta({ props, output: resolve(outputDirectory, `${variant}.mp4`), serveUrl: BUNDLE_DIR, concurrency, x264Preset: preset, browser })) });
		}
	} finally {
		await browser.close({ silent: true });
	}
	console.log(JSON.stringify({ event: "remotion_benchmark_complete", results }));
}

if (import.meta.main) await main();
