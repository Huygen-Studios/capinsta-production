import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openBrowser } from "@remotion/renderer";
import { validateRemotionProps } from "./contracts";
import { BUNDLE_DIR, GENERATED_DIR } from "./paths";
import { renderCapInsta } from "./render";

const PREMIUM_PRESETS = [
	"skyline_italic", "ember_focus", "citrus_signature", "volt_matrix",
	"ivory_signature", "cobalt_script", "mint_ink", "monument",
] as const;

async function main() {
	const outputDirectory = resolve(process.argv[2] ?? "artifacts/premium-smoke");
	await mkdir(outputDirectory, { recursive: true });
	const browser = await openBrowser("chrome", { logLevel: "warn", chromiumOptions: { enableMultiProcessOnLinux: true } });
	const results = [];
	try {
		for (const preset of PREMIUM_PRESETS) {
			const props = validateRemotionProps(JSON.parse(await readFile(resolve(GENERATED_DIR, `premium-${preset}.json`), "utf8")));
			results.push({ preset, ...(await renderCapInsta({
				props,
				output: resolve(outputDirectory, `${preset}.mp4`),
				serveUrl: BUNDLE_DIR,
				concurrency: 2,
				x264Preset: "superfast",
				browser,
			})) });
		}
	} finally {
		await browser.close({ silent: true });
	}
	console.log(JSON.stringify({ event: "remotion_premium_smoke_complete", results }));
}

if (import.meta.main) await main();
