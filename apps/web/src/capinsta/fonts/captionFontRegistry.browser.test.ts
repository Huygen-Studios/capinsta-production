import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CAPINSTA_FONT_REGISTRY } from "./captionFontRegistry";

function findChromiumExecutable(): string {
	const configured = process.env.CAPINSTA_CHROMIUM_EXECUTABLE;
	const candidates = [
		configured,
		"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
		"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
		"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
		"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
		"/usr/bin/google-chrome",
		"/usr/bin/google-chrome-stable",
		"/usr/bin/chromium",
		"/usr/bin/chromium-browser",
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	].filter((candidate): candidate is string => Boolean(candidate));
	const executable = candidates.find((candidate) => existsSync(candidate));
	if (!executable) {
		throw new Error(
			"Chromium is required for caption font preflight. Set CAPINSTA_CHROMIUM_EXECUTABLE to a Chrome, Chromium, or Edge executable.",
		);
	}
	return executable;
}

describe("Capinsta caption font browser preflight", () => {
	test(
		"every registered face loads in Chromium and passes document.fonts.check",
		() => {
			const faces = CAPINSTA_FONT_REGISTRY.flatMap((definition) =>
				definition.faces.map((fontFace, index) => {
					const filePath = path.join(
						process.cwd(),
						"public",
						"caption-fonts",
						...fontFace.file.split("/"),
					);
					return {
						family: `CapinstaPreflight-${definition.id}-${index}`,
						file: fontFace.file,
						format: fontFace.format,
						weight: fontFace.weight,
						style: fontFace.style,
						base64: readFileSync(filePath).toString("base64"),
					};
				}),
			);

			const browserScript = String.raw`
				import { chromium } from "@playwright/test";
				import { readFileSync } from "node:fs";
				const input = JSON.parse(readFileSync(0, "utf8"));
				const browser = await chromium.launch({
					executablePath: input.executablePath,
					headless: true,
				});
				const page = await browser.newPage();
				const browserErrors = [];
				page.on("console", (message) => {
					if (message.type() === "error" || message.type() === "warning") {
						browserErrors.push(message.text());
					}
				});
				await page.setContent("<!doctype html><title>Font preflight</title>");
				const results = await page.evaluate(async (fontFaces) => {
					const loaded = [];
					for (const fontFace of fontFaces) {
						const face = new FontFace(
							fontFace.family,
							"url(data:font/" + fontFace.format + ";base64," + fontFace.base64 + ") format(\"" + fontFace.format + "\")",
							{ weight: String(fontFace.weight), style: fontFace.style },
						);
						try {
							await face.load();
							document.fonts.add(face);
							const descriptor = fontFace.style + " " + fontFace.weight + " 32px \"" + fontFace.family + "\"";
							await document.fonts.load(descriptor);
							loaded.push({
								file: fontFace.file,
								ok: document.fonts.check(descriptor),
								status: face.status,
							});
						} catch (error) {
							loaded.push({
								file: fontFace.file,
								ok: false,
								status: face.status,
								error: error instanceof Error ? error.message : String(error),
							});
						}
					}
					return loaded;
				}, input.faces);
				await browser.close();
				console.log(JSON.stringify({ results, browserErrors }));
			`;
			const processResult = spawnSync(
				"node",
				["--input-type=module", "-e", browserScript],
				{
					cwd: process.cwd(),
					encoding: "utf8",
					input: JSON.stringify({
						executablePath: findChromiumExecutable(),
						faces,
					}),
					maxBuffer: 20 * 1024 * 1024,
					timeout: 30_000,
				},
			);

			expect(processResult.error).toBeUndefined();
			expect(processResult.status, processResult.stderr).toBe(0);
			const output = JSON.parse(processResult.stdout.trim()) as {
				results: Array<{ file: string; ok: boolean }>;
				browserErrors: string[];
			};
			expect(output.results.filter((result) => !result.ok)).toEqual([]);
			expect(
				output.browserErrors.filter((message) => message.includes("OTS")),
			).toEqual([]);
		},
		45_000,
	);
});
