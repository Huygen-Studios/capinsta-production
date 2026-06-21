import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const baseURL = process.env.CAPINSTA_QA_URL ?? "http://localhost:3001";
const artifactDir = resolve(process.cwd(), "artifacts/redesign");
mkdirSync(artifactDir, { recursive: true });
test.setTimeout(90_000);

const viewports = [
	{ name: "desktop", width: 1440, height: 1024 },
	{ name: "tablet", width: 1024, height: 768 },
	{ name: "mobile", width: 390, height: 844 },
];

for (const viewport of viewports) {
	test(`landing page renders cleanly at ${viewport.name}`, async ({ page }) => {
		const consoleErrors: string[] = [];
		const failedResources: string[] = [];
		page.on("console", (message) => {
			if (message.type() === "error") consoleErrors.push(message.text());
		});
		page.on("response", (response) => {
			if (response.status() >= 400) {
				failedResources.push(`${response.status()} ${response.url()}`);
			}
		});
		await page.setViewportSize(viewport);
		await page.goto(baseURL, { waitUntil: "domcontentloaded" });
		await expect(
			page.getByRole("heading", {
				level: 1,
				name: "Turn any video into animated captions.",
			}),
		).toBeVisible();
		await expect(
			page.getByText("Currently free during public beta.", { exact: true }),
		).toBeVisible();
		await expect(page.locator("html")).toHaveJSProperty(
			"scrollWidth",
			await page.locator("html").evaluate((element) => element.clientWidth),
		);
		expect(consoleErrors).toEqual([]);
		expect(failedResources).toEqual([]);
		await page.screenshot({
			path: resolve(artifactDir, `landing-${viewport.name}.png`),
			fullPage: true,
		});
	});
}

test("favicon package and public SEO routes resolve", async ({ request }) => {
	const paths = [
		"/favicon.ico",
		"/logos/favicon/favicon.ico",
		"/logos/favicon/favicon-16x16.png",
		"/logos/favicon/favicon-32x32.png",
		"/logos/favicon/apple-touch-icon.png",
		"/logos/favicon/android-chrome-192x192.png",
		"/logos/favicon/android-chrome-512x512.png",
		"/logos/favicon/site.webmanifest",
		"/caption-presets",
		"/compare/capinsta-vs-kapwing",
		"/brand",
	];
	for (const path of paths) {
		const response = await request.get(`${baseURL}${path}`);
		expect(response.status(), path).toBe(200);
	}
});

test("reduced motion retains poster content", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto(baseURL, { waitUntil: "domcontentloaded" });
	await expect(page.getByAltText("Creator recording a vertical video in a purple-lit studio").first()).toBeVisible();
	await expect(page.locator("video")).toHaveCount(0);
});
