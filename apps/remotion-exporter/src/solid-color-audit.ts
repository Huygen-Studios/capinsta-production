import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { assertSafeBenchmarkEnvironment } from "./benchmark-environment";
import { validateRemotionProps } from "./contracts";
import { exportHybrid } from "./hybrid-export";
import { APP_DIR, GENERATED_DIR } from "./paths";

const colors = ["#000000", "#FFFFFF", "#FF0066", "#18233A"];
const outputDirectory = resolve(APP_DIR, "artifacts/hybrid-color-audit");

function sampleRgb(path: string) {
	return new Promise<[number, number, number]>((resolvePromise, reject) => {
		const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", "1", "-i", path, "-an", "-vf", "crop=64:64:0:0,format=rgb24", "-frames:v", "1", "-f", "rawvideo", "pipe:1"], { stdio: ["ignore", "pipe", "pipe"] });
		const chunks: Buffer[] = [];
		let stderr = "";
		child.stdout.on("data", (chunk) => chunks.push(chunk));
		child.stderr.on("data", (chunk) => { stderr += chunk; });
		child.once("error", reject);
		child.once("exit", (code) => {
			if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${stderr}`));
			const pixels = Buffer.concat(chunks);
			const sums = [0, 0, 0];
			for (let index = 0; index < pixels.length; index += 3) {
				sums[0] += pixels[index]!; sums[1] += pixels[index + 1]!; sums[2] += pixels[index + 2]!;
			}
			const count = pixels.length / 3;
			resolvePromise(sums.map((sum) => sum / count) as [number, number, number]);
		});
	});
}

async function main() {
	assertSafeBenchmarkEnvironment();
	await mkdir(outputDirectory, { recursive: true });
	const props = validateRemotionProps(JSON.parse(await readFile(resolve(GENERATED_DIR, "benchmark-short.json"), "utf8")));
	const sourceFiles = new Map([["moving-source", resolve(GENERATED_DIR, "moving-source-30s.mp4")]]);
	const cases = [];
	for (const color of colors) {
		const output = resolve(outputDirectory, `${color.slice(1).toLowerCase()}.mp4`);
		const result = await exportHybrid({ props, base: { type: "solidColor", color }, sourceFiles, output });
		const actualRgb = await sampleRgb(output);
		const expectedRgb = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
		const maxChannelError = Math.max(...actualRgb.map((value, index) => Math.abs(value - expectedRgb[index]!)));
		cases.push({ color, expectedRgb, actualRgb, maxChannelError, remotionInvoked: result.remotionInvoked, verification: result.verification });
	}
	const report = { schemaVersion: 1, sample: "decoded H.264 64x64 top-left average at 1 second", cases, passed: cases.every((entry) => entry.maxChannelError <= 3 && !entry.remotionInvoked) };
	await writeFile(resolve(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
	if (!report.passed) throw new Error(`Solid color audit failed: ${JSON.stringify(report)}`);
	console.log(JSON.stringify({ event: "solid_color_audit_complete", report }));
}

if (import.meta.main) main().catch((error) => {
	console.error(JSON.stringify({ event: "solid_color_audit_error", message: error instanceof Error ? error.message : String(error) }));
	process.exitCode = 1;
});
