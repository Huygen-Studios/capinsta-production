import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function chromiumExecutable(): string {
	const candidates = [
		process.env.CAPINSTA_CHROMIUM_EXECUTABLE,
		"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
		"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
		"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
		"/usr/bin/google-chrome",
		"/usr/bin/chromium",
	].filter((value): value is string => Boolean(value));
	const executable = candidates.find(existsSync);
	if (!executable) throw new Error("Chromium is required for handoff storage QA");
	return executable;
}

describe("handoff storage in a real browser", () => {
	test(
		"imports, edits, saves, and reloads the exact v35 project without OPFS media bytes",
		async () => {
			const temp = path.join(
				process.cwd(),
				`.tmp-handoff-browser-${crypto.randomUUID()}`,
			);
			mkdirSync(temp);
			try {
				const entry = path.join(temp, "entry.ts");
				writeFileSync(
					entry,
					`
import { IndexedDBAdapter } from "../src/services/storage/indexeddb-adapter";
window.runHandoffStorageTest = async (project, descriptor) => {
  const projects = new IndexedDBAdapter({
    dbName: "video-editor-projects-handoff-browser-test",
    storeName: "projects",
    version: 1,
  });
  const imports = new IndexedDBAdapter({
    dbName: "video-editor-handoff-imports-handoff-browser-test",
    storeName: "handoff-imports",
    version: 1,
  });
  const media = new IndexedDBAdapter({
    dbName: "video-editor-media-handoff-browser-test-" + project.metadata.id,
    storeName: "media-metadata",
    version: 1,
  });
  await imports.set({ key: project.metadata.id, value: {
    schemaVersion: 1,
    projectId: project.metadata.id,
    handoffId: "22222222-2222-4222-8222-222222222222",
    conversionResultIdentity: "a".repeat(64),
    status: "importing",
  }});
  await projects.set({ key: project.metadata.id, value: project });
  await media.set({ key: descriptor.mediaId, value: {
    id: descriptor.mediaId,
    name: descriptor.displayName,
    type: "video",
    size: descriptor.sizeBytes,
    lastModified: 0,
    serverAssetId: descriptor.mediaAssetId,
    serverBackedDescriptor: descriptor,
    syncStatus: "synced",
  }});
  await imports.set({ key: project.metadata.id, value: {
    schemaVersion: 1,
    projectId: project.metadata.id,
    handoffId: "22222222-2222-4222-8222-222222222222",
    conversionResultIdentity: "a".repeat(64),
    status: "imported",
  }});
  const loaded = await projects.get(project.metadata.id);
  loaded.metadata.name = "Edited after handoff";
  loaded.scenes[0].tracks.overlay[0].elements[0].params.content = "Edited caption";
  loaded.scenes[0].tracks.main.elements[0].params.opacity = 0.75;
  await projects.set({ key: project.metadata.id, value: loaded });
  const reloaded = await projects.get(project.metadata.id);
  const record = await imports.get(project.metadata.id);
  const mediaMetadata = await media.get(descriptor.mediaId);
  return {
    projectId: reloaded.metadata.id,
    name: reloaded.metadata.name,
    version: reloaded.version,
    elementId: reloaded.scenes[0].tracks.main.elements[0].id,
    mediaId: reloaded.scenes[0].tracks.main.elements[0].mediaId,
    sourceAssetId: reloaded.scenes[0].tracks.main.elements[0].sourceAssetId,
    trimStart: reloaded.scenes[0].tracks.main.elements[0].trimStart,
    trimEnd: reloaded.scenes[0].tracks.main.elements[0].trimEnd,
    captionId: reloaded.scenes[0].tracks.overlay[0].elements[0].id,
    captionContent: reloaded.scenes[0].tracks.overlay[0].elements[0].params.content,
    opacity: reloaded.scenes[0].tracks.main.elements[0].params.opacity,
    canvas: reloaded.settings.canvasSize,
    provenance: reloaded.capinstaClippingProvenance,
    importStatus: record.status,
    descriptor: mediaMetadata.serverBackedDescriptor,
    hasPersistedUrl: JSON.stringify({ project: reloaded, mediaMetadata }).toLowerCase().includes("signed-url")
      || JSON.stringify({ project: reloaded, mediaMetadata }).includes("https://"),
  };
};`,
					"utf8",
				);
				const build = await Bun.build({
					entrypoints: [entry],
					target: "browser",
					format: "iife",
					minify: true,
				});
				expect(build.success, build.logs.map(String).join("\n")).toBe(true);
				const script = await build.outputs[0].text();
				const fixture = JSON.parse(
					readFileSync(
						path.resolve(
							process.cwd(),
							"../../contracts/fixtures/capinsta-project-conversion-v1/valid/project-with-remapped-captions.json",
						),
						"utf8",
					),
				);
				const project = fixture.result.project;
				const mediaId = "11111111-1111-4111-8111-111111111111";
				project.metadata.id = "capinsta_browser_handoff";
				project.scenes[0].tracks.main.elements[0].mediaId = mediaId;
				project.scenes[0].tracks.main.elements[0].sourceAssetId = mediaId;
				const descriptor = {
					schemaVersion: 1,
					mediaId,
					mediaAssetId: mediaId,
					sourceType: "server-backed",
					mediaKind: "video",
					mimeType: "video/mp4",
					displayName: "Synthetic source.mp4",
					sizeBytes: 100,
					durationMs: 60_000,
					width: 1080,
					height: 1920,
					storageProvider: "supabase",
					accessMode: "authenticated-server-backed",
					requiresBrowserPersistence: false,
				};
				const browserScript = String.raw`
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const input = JSON.parse(readFileSync(0, "utf8"));
const browser = await chromium.launch({
  executablePath: input.executablePath,
  headless: true,
});
try {
  const page = await browser.newPage();
  await page.route("http://capinsta.test/", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<title>handoff storage</title>",
  }));
  await page.goto("http://capinsta.test/", { waitUntil: "domcontentloaded", timeout: 10000 });
  await page.addScriptTag({ content: input.script });
  const result = await page.evaluate(
    async ({ project, descriptor }) => window.runHandoffStorageTest(project, descriptor),
    { project: input.project, descriptor: input.descriptor },
  );
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}`;
				const processResult = spawnSync(
					"node",
					["--input-type=module", "-e", browserScript],
					{
						cwd: process.cwd(),
						encoding: "utf8",
						input: JSON.stringify({
							executablePath: chromiumExecutable(),
							script,
							project,
							descriptor,
						}),
						timeout: 30_000,
						maxBuffer: 10 * 1024 * 1024,
					},
				);
				expect(processResult.error).toBeUndefined();
				expect(processResult.status, processResult.stderr).toBe(0);
				const result = JSON.parse(processResult.stdout.trim());
				expect(result).toEqual({
						projectId: "capinsta_browser_handoff",
						name: "Edited after handoff",
						version: 35,
						elementId: project.scenes[0].tracks.main.elements[0].id,
						mediaId,
						sourceAssetId: mediaId,
						trimStart: project.scenes[0].tracks.main.elements[0].trimStart,
						trimEnd: project.scenes[0].tracks.main.elements[0].trimEnd,
						captionId:
							project.scenes[0].tracks.overlay[0].elements[0].id,
						captionContent: "Edited caption",
						opacity: 0.75,
						canvas: { width: 1080, height: 1920 },
						provenance: project.capinstaClippingProvenance,
						importStatus: "imported",
						descriptor,
						hasPersistedUrl: false,
					});
			} finally {
				rmSync(temp, { recursive: true, force: true });
			}
		},
		60_000,
	);
});
