import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { assertSafeBenchmarkEnvironment } from "./benchmark-environment";
import { validateRemotionProps } from "./contracts";
import { exportHybrid } from "./hybrid-export";
import { APP_DIR, BUNDLE_DIR, GENERATED_DIR } from "./paths";

const premiumPresets = ["skyline_italic", "ember_focus", "citrus_signature", "volt_matrix", "ivory_signature", "cobalt_script", "mint_ink", "monument"];
const artifactsDirectory = resolve(APP_DIR, "artifacts/hybrid-acceptance");
const tempRoot = resolve(tmpdir(), "capinsta-remotion-overlay");
const sourceFiles = new Map([["moving-source", resolve(GENERATED_DIR, "moving-source-30s.mp4")]]);

async function fixture(name: string) {
	return validateRemotionProps(JSON.parse(await readFile(resolve(GENERATED_DIR, `${name}.json`), "utf8")));
}

async function tempJobs() {
	return existsSync(tempRoot) ? (await readdir(tempRoot)).sort() : [];
}

async function main() {
	assertSafeBenchmarkEnvironment();
	await mkdir(artifactsDirectory, { recursive: true });
	const premium = [];
	for (const preset of premiumPresets) {
		const result = await exportHybrid({ props: await fixture(`premium-${preset}`), base: { type: "video" }, sourceFiles, output: resolve(artifactsDirectory, `premium-${preset}.mp4`), serveUrl: BUNDLE_DIR, concurrency: 4 });
		premium.push({ preset, ...result });
	}

	const before = await tempJobs();
	const controller = new AbortController();
	const cancellationOutput = resolve(artifactsDirectory, "cancelled-partial.mp4");
	setTimeout(() => controller.abort(), 1_500);
	let cancelled = false;
	try {
		await exportHybrid({ props: await fixture("ordinary-short"), base: { type: "video" }, sourceFiles, output: cancellationOutput, serveUrl: BUNDLE_DIR, concurrency: 4, signal: controller.signal });
	} catch (error) {
		cancelled = /cancel/i.test(error instanceof Error ? error.message : String(error));
	}
	const after = await tempJobs();
	const cancellation = { cancelled, partialOutputExists: existsSync(cancellationOutput), tempWorkspaceBefore: before, tempWorkspaceAfter: after, cleaned: JSON.stringify(before) === JSON.stringify(after) };
	if (!cancelled || cancellation.partialOutputExists || !cancellation.cleaned) throw new Error(`Cancellation acceptance failed: ${JSON.stringify(cancellation)}`);
	const report = { schemaVersion: 1, premium, cancellation, passed: premium.length === premiumPresets.length && premium.every((entry) => entry.verification.pixelFormatContractValid) };
	await writeFile(resolve(artifactsDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
	console.log(JSON.stringify({ event: "hybrid_acceptance_complete", reportPath: resolve(artifactsDirectory, "report.json"), cancellation }));
}

if (import.meta.main) main().catch((error) => {
	console.error(JSON.stringify({ event: "hybrid_acceptance_error", message: error instanceof Error ? error.message : String(error) }));
	process.exitCode = 1;
});
