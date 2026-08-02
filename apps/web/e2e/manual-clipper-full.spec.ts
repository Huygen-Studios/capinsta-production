import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test.skip(process.env.CAPINSTA_FULL_CLIPPER_E2E !== "true", "requires the disposable PostgreSQL and worker stack");

type Batch = {
	id: string;
	sourceMediaAssetId: string;
	items: Array<{
		id: string;
		childProjectId: string | null;
		childProjectRevision: number | null;
		sourceStartMs: number;
		sourceEndMs: number;
		captionStatus: string;
	}>;
};

async function api<T>(page: Page, path: string, init?: RequestInit): Promise<T> {
	return page.evaluate(async ({ path, init }) => {
		const response = await fetch(`/api/capinsta/api${path}`, init);
		const body: unknown = await response.json();
		if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body)}`);
		return body as T;
	}, { path, init });
}

async function batch(page: Page): Promise<Batch> {
	const id = await page.evaluate(() => localStorage.getItem("capinsta:manual-clip-batch-v1"));
	if (!id) throw new Error("clip batch restore key is missing");
	return api<Batch>(page, `/clipping/batches/${id}`);
}

function probe(path: string) {
	const output = execFileSync("ffprobe", [
		"-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height",
		"-show_entries", "format=duration", "-of", "json", path,
	], { encoding: "utf8" });
	const parsed = JSON.parse(output) as { streams?: unknown[]; format?: { duration?: string } };
	expect(parsed.streams?.length).toBe(1);
	expect(Number(parsed.format?.duration)).toBeGreaterThan(0);
}

test("five manual clips persist captions and render individual and ZIP exports", async ({ page }) => {
	test.setTimeout(1_200_000);
	const root = mkdtempSync(join(tmpdir(), "capinsta-manual-e2e-"));
	const source = join(root, "manual-clipper-source.mp4");
	execFileSync("ffmpeg", [
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24:duration=24",
		"-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=24",
		"-vf", "drawtext=text='%{pts\\:hms}':x=12:y=12:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.5",
		"-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source,
	]);

	try {
		await page.addInitScript(() => {
			localStorage.setItem("theme", "dark");
			localStorage.setItem("hasSeenOnboarding", "true");
			localStorage.setItem("capinsta-editor-onboarding:v1", "true");
			localStorage.setItem("capinsta-cookie-consent", JSON.stringify({ necessary: true, analytics: false, advertising: false, updatedAt: new Date().toISOString() }));
		});
		const automaticRequests: string[] = [];
		page.on("request", (request) => {
			if (/\/(advance|candidates|analysis|transcripts)(\/|$)/.test(new URL(request.url()).pathname)) automaticRequests.push(request.url());
		});

		await page.goto("/clipper");
		await expect(page.getByRole("heading", { name: "Create clips from one video" })).toBeVisible();
		await page.locator('input[type="file"]').setInputFiles(source);
		await page.getByRole("button", { name: "Open in editor" }).click();
		await Promise.race([
			page.waitForURL(/\/editor\/[^/?]+\?clipBatch=/, { timeout: 240_000 }),
			page.getByRole("alert").waitFor({ state: "visible" }).then(async () => {
				throw new Error((await page.getByRole("alert").textContent()) ?? "Clipper upload failed");
			}),
		]);
		await expect(page.getByTestId("editor-ready")).toBeVisible({ timeout: 120_000 });
		await expect(page.locator("canvas").first()).toBeVisible();
		await expect(page.locator('[data-tour="timeline"]')).toBeVisible();
		await expect(page.getByTestId("clip-batch-dock")).toBeVisible();
		expect(automaticRequests).toEqual([]);

		await page.getByRole("button", { name: "Create clips" }).click();
		await page.getByLabel("Number of clips").fill("5");
		await page.getByLabel("Maximum duration (seconds)").fill("10");
		await page.getByLabel("Add captions").click();
		await page.getByLabel("Add headings").click();
		await page.getByRole("button", { name: "Create clip regions" }).click();
		await expect(page.getByTestId("clip-batch-item")).toHaveCount(5);
		await expect(page.getByTestId("clip-range")).toHaveCount(5);

		const ranges = [[0, 5_000], [3_000, 8_000], [8_000, 13_000], [13_000, 18_000], [17_000, 22_000]];
		for (const [index, [start, end]] of ranges.entries()) {
			const row = page.getByTestId("clip-batch-item").nth(index);
			await row.getByLabel("Start ms").fill(String(start));
			await row.getByLabel("End ms").fill(String(end));
			await row.getByRole("button", { name: "Save" }).click();
			await expect(row.getByLabel("Start ms")).toHaveValue(String(start));
		}
		for (const index of [2, 3, 4]) await page.getByTestId("clip-batch-item").nth(index).getByRole("checkbox").click();

		const completedCaptionItems = new Set<string>();
		const captionStartOrder: string[] = [];
		page.on("request", (request) => {
			if (request.method() !== "POST" || !request.url().endsWith("/captions")) return;
			const itemId = (request.postDataJSON() as { itemId: string }).itemId;
			if (captionStartOrder.length) expect(completedCaptionItems.has(captionStartOrder.at(-1)!)).toBe(true);
			captionStartOrder.push(itemId);
		});
		page.on("response", async (response) => {
			if (response.request().method() !== "GET" || !/\/captions\/[^/]+$/.test(new URL(response.url()).pathname)) return;
			const value = await response.json().catch(() => null) as { status?: string } | null;
			if (value?.status === "completed") completedCaptionItems.add(new URL(response.url()).pathname.split("/").at(-1)!);
		});

		await page.getByRole("button", { name: "Confirm ranges" }).click();
		await expect(page.getByRole("status")).toContainText("Clip projects are ready", { timeout: 360_000 });
		const created = await batch(page);
		expect(created.items).toHaveLength(5);
		expect(new Set(created.items.map((item) => item.childProjectId)).size).toBe(5);
		expect(created.items.every((item) => item.childProjectRevision !== null)).toBe(true);
		expect(created.items.slice(0, 2).every((item) => item.captionStatus === "completed")).toBe(true);
		expect(created.items.slice(2).every((item) => item.captionStatus === "not_requested")).toBe(true);
		expect(captionStartOrder).toEqual(created.items.slice(0, 2).map((item) => item.id));
		expect(created.items[0].sourceEndMs).toBeGreaterThan(created.items[1].sourceStartMs);
		expect(created.items.every((item) => item.sourceEndMs - item.sourceStartMs <= 180_000)).toBe(true);

		for (const [index, item] of created.items.entries()) {
			const project = await api<unknown>(page, `/clipping/projects/${item.childProjectId}`);
			const serialized = JSON.stringify(project);
			expect(serialized).toContain(created.sourceMediaAssetId);
			expect(serialized).toContain("Clip");
			if (index < 2) expect(serialized).toContain("Deterministic caption");
		}

		await page.reload();
		await expect(page.getByTestId("editor-ready")).toBeVisible({ timeout: 120_000 });
		await expect(page.getByTestId("clip-batch-item")).toHaveCount(5);
		const restored = await batch(page);
		expect(restored.items.slice(0, 2).every((item) => item.captionStatus === "completed")).toBe(true);
		await page.getByTestId("clip-batch-item").first().getByRole("button", { name: "1", exact: true }).click();
		await page.waitForURL(/\/editor\/[^/?]+\?clipBatch=.*clipItem=/, { timeout: 240_000 });
		await expect(page.getByTestId("editor-ready")).toBeVisible({ timeout: 120_000 });

		await page.getByTestId("clip-batch-item").nth(1).getByRole("checkbox").click();
		const individualDownload = page.waitForEvent("download", { timeout: 480_000 });
		await page.getByRole("button", { name: "Export selected" }).click();
		const individual = await individualDownload;
		const individualPath = join(root, "individual.mp4");
		await individual.saveAs(individualPath);
		probe(individualPath);

		await page.getByTestId("clip-batch-item").nth(1).getByRole("checkbox").click();
		const zipDownload = page.waitForEvent("download", { timeout: 600_000 });
		await page.getByRole("button", { name: "Export selected" }).click();
		const archive = await zipDownload;
		const archivePath = join(root, "selected.zip");
		await archive.saveAs(archivePath);
		const unpacked = join(root, "unzipped");
		execFileSync("unzip", ["-q", archivePath, "-d", unpacked]);
		const manifest = JSON.parse(readFileSync(join(unpacked, "manifest.json"), "utf8")) as { items: Array<{ filename: string }> };
		expect(manifest.items).toHaveLength(2);
		for (const item of manifest.items) probe(join(unpacked, item.filename));

		const batchId = restored.id;
		page.once("dialog", (dialog) => dialog.accept());
		await page.getByRole("button", { name: "Delete batch" }).click();
		await page.waitForURL(/\/clipper$/);
		const repeated = await page.evaluate(async (id) => {
			const response = await fetch(`/api/capinsta/api/clipping/batches/${id}`, { method: "DELETE" });
			return response.status;
		}, batchId);
		expect([200, 404]).toContain(repeated);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
