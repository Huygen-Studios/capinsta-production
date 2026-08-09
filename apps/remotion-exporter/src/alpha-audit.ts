import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { ALPHA_AUDIT_FULL_FRAME_ID, ALPHA_AUDIT_OVERLAY_ID } from "./AlphaAuditComposition";
import { APP_DIR, BUNDLE_DIR } from "./paths";

const outputDirectory = resolve(APP_DIR, "artifacts/hybrid-alpha-audit");
const colors = ["#000000", "#FFFFFF", "#FF0066", "#18233A"];

function run(command: string, args: string[], cwd?: string) {
	return new Promise<string>((resolvePromise, reject) => {
		const child = spawn(command, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
		let stderr = "";
		child.stderr.on("data", (chunk) => { stderr += chunk; });
		child.once("error", reject);
		child.once("exit", (code) => code === 0 ? resolvePromise(stderr) : reject(new Error(`${command} exited ${code}: ${stderr}`)));
	});
}

async function main() {
	await mkdir(outputDirectory, { recursive: true });
	const browser = await openBrowser("chrome", { logLevel: "warn" });
	const overlay = await selectComposition({ serveUrl: BUNDLE_DIR, id: ALPHA_AUDIT_OVERLAY_ID, inputProps: { backgroundColor: null }, puppeteerInstance: browser, logLevel: "warn" });
	const overlayPath = resolve(outputDirectory, "overlay.png");
	await renderStill({ serveUrl: BUNDLE_DIR, composition: overlay, inputProps: { backgroundColor: null }, output: overlayPath, imageFormat: "png", puppeteerInstance: browser, overwrite: true, logLevel: "warn" });
	const results = [];
	try {
		for (const color of colors) {
			const slug = color.slice(1).toLowerCase();
			const fullPath = resolve(outputDirectory, `full-${slug}.png`);
			const composedPath = resolve(outputDirectory, `hybrid-${slug}.png`);
			const statsPath = resolve(outputDirectory, `psnr-${slug}.log`);
			const full = await selectComposition({ serveUrl: BUNDLE_DIR, id: ALPHA_AUDIT_FULL_FRAME_ID, inputProps: { backgroundColor: color }, puppeteerInstance: browser, logLevel: "warn" });
			await renderStill({ serveUrl: BUNDLE_DIR, composition: full, inputProps: { backgroundColor: color }, output: fullPath, imageFormat: "png", puppeteerInstance: browser, overwrite: true, logLevel: "warn" });
			await run("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", `color=c=${color}:s=1080x1920:r=1`, "-i", overlayPath, "-filter_complex", "[0:v]format=rgba[base];[base][1:v]overlay=alpha=straight:format=rgb[out]", "-map", "[out]", "-frames:v", "1", composedPath]);
			const psnrOutput = await run("ffmpeg", ["-hide_banner", "-i", fullPath, "-i", composedPath, "-lavfi", `psnr=stats_file=${`psnr-${slug}.log`}`, "-f", "null", "NUL"], outputDirectory);
			const match = /average:(inf|[0-9.]+)/.exec(psnrOutput);
			results.push({ color, psnrDb: match ? (match[1] === "inf" ? 999 : Number(match[1])) : null, stats: (await readFile(statsPath, "utf8")).trim() });
		}
	} finally {
		await browser.close({ silent: true });
	}
	const report = { schemaVersion: 1, alphaInputPixelFormat: "rgba", ffmpegAlphaMode: "straight", cases: results, passed: results.every((entry) => entry.psnrDb !== null && entry.psnrDb > 35) };
	await writeFile(resolve(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
	if (!report.passed) throw new Error(`Alpha audit failed: ${JSON.stringify(report)}`);
	console.log(JSON.stringify({ event: "hybrid_alpha_audit_complete", report }));
}

if (import.meta.main) main().catch((error) => {
	console.error(JSON.stringify({ event: "hybrid_alpha_audit_error", message: error instanceof Error ? error.message : String(error) }));
	process.exitCode = 1;
});
