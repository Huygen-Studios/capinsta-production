import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";

test.skip(
	process.env.CAPINSTA_FULL_CLIPPER_E2E !== "true",
	"requires FFmpeg and a Chromium browser with WebCodecs",
);

const forbiddenManualPath =
	/\/clipping\/(?:media\/(?:uploads|assets)|batches|projects|exports|workflows)|conversion|derivation|handoff/i;

function probe(path: string) {
	const output = execFileSync(
		"ffprobe",
		[
			"-v",
			"error",
			"-select_streams",
			"v:0",
			"-show_entries",
			"stream=codec_name,width,height",
			"-show_entries",
			"format=duration",
			"-of",
			"json",
			path,
		],
		{ encoding: "utf8" },
	);
	const parsed = JSON.parse(output) as {
		streams?: unknown[];
		format?: { duration?: string };
	};
	expect(parsed.streams).toHaveLength(1);
	expect(Number(parsed.format?.duration)).toBeGreaterThan(0);
}

async function openClip(page: Page, index: number) {
	await page
		.getByTestId("clip-batch-item")
		.nth(index)
		.getByRole("button", { name: String(index + 1), exact: true })
		.click();
}

async function persistedProject(page: Page) {
	const projectId = new URL(page.url()).pathname.split("/").at(-1);
	return page.evaluate(async (id) => {
		for (const info of await indexedDB.databases()) {
			if (!info.name?.startsWith("video-editor-projects")) continue;
			const value = await new Promise<unknown[]>((resolve, reject) => {
				const request = indexedDB.open(info.name!);
				request.onerror = () => reject(request.error);
				request.onsuccess = () => {
					const db = request.result;
					const get = db
						.transaction("projects", "readonly")
						.objectStore("projects")
						.getAll();
					get.onerror = () => reject(get.error);
					get.onsuccess = () => resolve(get.result);
				};
			});
			const found = value.find(
				(item) =>
					typeof item === "object" &&
					item !== null &&
					Reflect.get(Reflect.get(item, "metadata") ?? {}, "id") === id,
			);
			if (found) return found;
		}
		throw new Error("persisted editor project was not found");
	}, projectId);
}

test("local clipping mode preserves independent edits, bounded captions, and browser exports", async ({
	page,
}) => {
	test.setTimeout(1_200_000);
	const root = mkdtempSync(join(tmpdir(), "capinsta-local-clips-"));
	const source = join(root, "local-clipping-source.mp4");
	execFileSync("ffmpeg", [
		"-hide_banner",
		"-loglevel",
		"error",
		"-y",
		"-f",
		"lavfi",
		"-i",
		"testsrc2=size=320x180:rate=24:duration=6",
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=880:sample_rate=48000:duration=6",
		"-vf",
		"drawtext=text='%{pts\\:hms}':x=12:y=12:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.5",
		"-c:v",
		"libx264",
		"-preset",
		"ultrafast",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-shortest",
		source,
	]);

	try {
		await page.addInitScript(() => {
			localStorage.setItem("theme", "dark");
			localStorage.setItem("hasSeenOnboarding", "true");
			localStorage.setItem("capinsta-editor-onboarding:v1", "true");
			localStorage.setItem(
				"capinsta-cookie-consent",
				JSON.stringify({
					necessary: true,
					analytics: false,
					advertising: false,
					updatedAt: new Date().toISOString(),
				}),
			);
		});
		const forbiddenRequests: string[] = [];
		let manualPhase = true;
		page.on("request", (request) => {
			if (
				manualPhase &&
				forbiddenManualPath.test(new URL(request.url()).pathname)
			)
				forbiddenRequests.push(request.url());
		});
		page.on("dialog", (dialog) => dialog.accept());

		await page.goto("/clipper");
		await page.waitForURL(/\/editor\/[^/?]+\?mode=clipping/);
		await page.goto(new URL(page.url()).pathname);
		await expect(page.getByTestId("editor-ready")).toBeVisible({
			timeout: 120_000,
		});
		await expect(
			page.getByRole("button", { name: "Create clips" }),
		).toBeVisible();
		await page.locator('input[type="file"]').first().setInputFiles(source);
		await expect(
			page.getByText("local-clipping-source.mp4", { exact: true }),
		).toBeVisible({ timeout: 120_000 });
		await expect(page.locator("canvas").first()).toBeVisible();
		await page.getByRole("button", { name: "Settings" }).click();
		await page.getByRole("button", { name: /Custom/ }).click();
		await page.getByLabel("Canvas width").fill("320");
		await page.getByLabel("Canvas width").blur();
		await page.getByLabel("Canvas height").fill("180");
		await page.getByLabel("Canvas height").blur();
		await page.getByRole("button", { name: "Create clips" }).click();
		await expect(page.getByTestId("clip-batch-dock")).toBeVisible();
		expect(forbiddenRequests).toEqual([]);

		await page
			.getByTestId("clip-batch-dock")
			.getByRole("button", { name: "Create clips" })
			.click();
		await page.getByLabel("Number of clips").fill("5");
		await page.getByLabel("Maximum duration (seconds)").fill("3");
		await page.getByLabel("Platform / aspect ratio").click();
		await page.getByRole("option", { name: "Current custom ratio" }).click();
		await page.getByLabel("Add captions").click();
		await page.getByLabel("Add heading text").click();
		await page
			.getByRole("button", { name: "Create clips", exact: true })
			.last()
			.click();
		await expect(page.getByTestId("clip-batch-item")).toHaveCount(5);
		await expect(page.getByTestId("clip-range")).toHaveCount(5);

		const ranges = [
			[0, 1_000],
			[500, 1_500],
			[1_500, 2_500],
			[2_500, 3_500],
			[3_500, 4_500],
		];
		for (const [index, [start, end]] of ranges.entries()) {
			const row = page.getByTestId("clip-batch-item").nth(index);
			await row
				.getByLabel(`Start time for clip ${index + 1}`)
				.fill(String(start));
			await row.getByLabel(`End time for clip ${index + 1}`).fill(String(end));
			await row.getByRole("button", { name: "Save" }).click();
			await expect(row.getByText("00:01.000", { exact: false })).toBeVisible();
		}
		expect(forbiddenRequests).toEqual([]);

		await openClip(page, 0);
		await page.getByText("Add a heading", { exact: true }).last().click();
		const headingField = page
			.getByText("Content", { exact: true })
			.locator("..")
			.locator("..")
			.locator("textarea");
		await headingField.fill("Clip 1 heading");
		await headingField.blur();
		await openClip(page, 1);
		await expect(page.getByText("Clip 1 heading", { exact: true })).toHaveCount(
			0,
		);
		await expect(
			page.getByText("Add a heading", { exact: true }),
		).toBeVisible();
		await openClip(page, 0);
		await expect(
			page.getByText("Clip 1 heading", { exact: true }),
		).toBeVisible();

		let submittedCaptionDuration = 0;
		let submittedCaptionBytes = 0;
		await page.route("**/api/capinsta/**", async (route) => {
			const request = route.request();
			const path = new URL(request.url()).pathname;
			if (path.endsWith("/health")) {
				await route.fulfill({
					json: {
						status: "ok",
						apiContractVersion: 1,
						capabilities: ["captions", "jobs"],
					},
				});
				return;
			}
			if (request.method() === "POST" && path.endsWith("/api/jobs")) {
				const body = request.postDataBuffer();
				if (!body) throw new Error("caption request body is missing");
				const riff = body.indexOf(Buffer.from("RIFF"));
				if (riff < 0)
					throw new Error("caption request does not contain WAV media");
				const channels = body.readUInt16LE(riff + 22);
				const sampleRate = body.readUInt32LE(riff + 24);
				const bits = body.readUInt16LE(riff + 34);
				const dataBytes = body.readUInt32LE(riff + 40);
				submittedCaptionDuration =
					dataBytes / (sampleRate * channels * (bits / 8));
				submittedCaptionBytes = dataBytes;
				await route.fulfill({
					json: {
						job_id: "local-caption-e2e",
						status: "queued",
						replayed: false,
					},
				});
				return;
			}
			if (path.endsWith("/api/jobs/local-caption-e2e")) {
				await route.fulfill({
					json: {
						job_id: "local-caption-e2e",
						status: "completed",
						progress: 100,
						filename: "bounded.caption.wav",
						languageMode: "english",
						transcript: {
							languageMode: "english",
							provider: { name: "unknown", model: "e2e" },
							segments: [
								{
									id: "segment-1",
									start: 0,
									end: 0.8,
									text: "Local only caption",
									words: [
										{
											word: "Local",
											displayedWord: "Local",
											start: 0,
											end: 0.35,
											timingSource: "provider",
										},
										{
											word: "caption",
											displayedWord: "caption",
											start: 0.4,
											end: 0.8,
											timingSource: "provider",
										},
									],
								},
							],
							metadata: { audio: { duration: 1 } },
						},
					},
				});
				return;
			}
			await route.fallback();
		});
		await openClip(page, 1);
		await page
			.getByTestId("clip-batch-item")
			.nth(1)
			.getByRole("button", { name: "Captions" })
			.click();
		await expect(
			page.getByTestId("clip-batch-item").nth(1).getByText("completed", {
				exact: false,
			}),
		).toBeVisible({ timeout: 120_000 });
		expect(submittedCaptionDuration).toBeGreaterThan(0.95);
		expect(submittedCaptionDuration).toBeLessThan(1.05);
		expect(submittedCaptionBytes).toBeLessThan(statSync(source).size);
		await expect(
			page.getByText("Local only caption", { exact: true }),
		).toBeVisible();
		await openClip(page, 0);
		await expect(
			page.getByText("Local only caption", { exact: true }),
		).toHaveCount(0);
		for (let index = 0; index < 5; index++) await openClip(page, index);

		const persisted = JSON.stringify(await persistedProject(page));
		expect(persisted).toContain("Clip 1 heading");
		expect(persisted).toContain("Local only caption");
		expect(
			persisted.match(/local-clipping-source\.mp4/g)?.length,
		).toBeGreaterThan(0);
		expect(forbiddenRequests).toEqual([]);

		await openClip(page, 0);
		const currentDownload = page.waitForEvent("download", { timeout: 180_000 });
		await page.getByRole("button", { name: "Export current" }).click();
		const currentPath = join(root, "current.mp4");
		await (await currentDownload).saveAs(currentPath);
		probe(currentPath);

		for (const index of [2, 3, 4])
			await page
				.getByTestId("clip-batch-item")
				.nth(index)
				.getByRole("checkbox")
				.click();
		const selectedDownload = page.waitForEvent("download", {
			timeout: 180_000,
		});
		await page.getByRole("button", { name: "Export selected" }).click();
		const selectedZip = join(root, "selected.zip");
		await (await selectedDownload).saveAs(selectedZip);
		const selectedFiles = unzipSync(new Uint8Array(readFileSync(selectedZip)));
		const selectedManifest = JSON.parse(
			strFromU8(selectedFiles["manifest.json"]!),
		) as { schemaVersion: number; clips: Array<{ filename: string }> };
		expect(selectedManifest.schemaVersion).toBe(1);
		expect(selectedManifest.clips).toHaveLength(2);
		for (const clip of selectedManifest.clips) {
			expect(clip.filename).not.toMatch(/\.\.|[\\/]/);
			const output = join(root, `selected-${clip.filename}`);
			writeFileSync(output, selectedFiles[clip.filename]!);
			probe(output);
		}

		for (const index of [2, 3, 4])
			await page
				.getByTestId("clip-batch-item")
				.nth(index)
				.getByRole("checkbox")
				.click();
		const allDownload = page.waitForEvent("download", { timeout: 180_000 });
		await page.getByRole("button", { name: "Export all" }).click();
		const allZip = join(root, "all.zip");
		await (await allDownload).saveAs(allZip);
		const allFiles = unzipSync(new Uint8Array(readFileSync(allZip)));
		const allManifest = JSON.parse(strFromU8(allFiles["manifest.json"]!)) as {
			clips: Array<{
				filename: string;
				sourceStartMs: number;
				sourceEndMs: number;
			}>;
		};
		expect(allManifest.clips).toHaveLength(5);
		for (const clip of allManifest.clips) {
			expect(clip.sourceEndMs - clip.sourceStartMs).toBeLessThanOrEqual(
				180_000,
			);
			const output = join(root, `all-${clip.filename}`);
			writeFileSync(output, allFiles[clip.filename]!);
			probe(output);
		}
		expect(forbiddenRequests).toEqual([]);

		await page.reload();
		await expect(page.getByTestId("editor-ready")).toBeVisible({
			timeout: 120_000,
		});
		await expect(page.getByTestId("clip-batch-item")).toHaveCount(5);
		await openClip(page, 0);
		await expect(
			page.getByText("Clip 1 heading", { exact: true }),
		).toBeVisible();
		await openClip(page, 1);
		await expect(
			page.getByText("Local only caption", { exact: true }),
		).toBeVisible();
		await page.getByRole("button", { name: "Normal editing" }).click();
		await expect(page.getByTestId("clip-batch-dock")).toHaveCount(0);
		await page.getByRole("button", { name: "Media" }).click();
		await expect(
			page.getByText("local-clipping-source.mp4", { exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Create clips" }),
		).toBeVisible();
		expect(forbiddenRequests).toEqual([]);

		manualPhase = false;
		await page.goto("/clipper/automatic");
		await expect(
			page.getByText("Automatic Clipper", { exact: true }),
		).toBeVisible();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
