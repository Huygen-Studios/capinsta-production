import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";

const baseURL = process.env.CAPINSTA_QA_URL ?? "http://127.0.0.1:3000";
const screenshotDir =
	process.env.CAPINSTA_QA_SCREENSHOTS ??
	resolve(process.env.TEMP ?? process.cwd(), "capinsta-theme-qa");
mkdirSync(screenshotDir, { recursive: true });

test.setTimeout(90_000);

async function setTheme(page: import("@playwright/test").Page, theme: "light" | "dark") {
	await page.addInitScript((selectedTheme) => {
		localStorage.setItem("theme", selectedTheme);
	}, theme);
}

for (const viewport of [
	{ name: "desktop", width: 1440, height: 1024 },
	{ name: "mobile", width: 390, height: 844 },
]) {
	for (const theme of ["light", "dark"] as const) {
		test(`homepage ${theme} theme at ${viewport.name}`, async ({ page }) => {
			await page.setViewportSize(viewport);
			await setTheme(page, theme);
			await page.goto(baseURL, { waitUntil: "domcontentloaded" });
			await expect(page.locator("html")).toHaveClass(new RegExp(theme));
			const rootBackground = await page.locator(".marketing-theme").first().evaluate(
				(element) => getComputedStyle(element).backgroundColor,
			);
			expect(rootBackground).not.toBe("rgba(0, 0, 0, 0)");
			await expect(page.locator("header")).toBeVisible();
			await page.screenshot({
				path: resolve(screenshotDir, `homepage-${viewport.name}-${theme}.png`),
				fullPage: true,
			});
		});
	}
}

test("theme toggle changes root class and persists after reload", async ({ page }) => {
	await page.goto(baseURL, { waitUntil: "domcontentloaded" });
	await page.evaluate(() => localStorage.setItem("theme", "light"));
	await page.reload({ waitUntil: "domcontentloaded" });
	await page.waitForTimeout(1_000);
	await page.getByRole("button", { name: "Use dark theme" }).click();
	await expect(page.locator("html")).toHaveClass(/dark/);
	await page.reload({ waitUntil: "domcontentloaded" });
	await expect(page.locator("html")).toHaveClass(/dark/);
});

for (const entry of [
	{ name: "auth", route: "/sign-in" },
	{ name: "comparison", route: "/compare/capinsta-vs-kapwing" },
	{ name: "presets", route: "/caption-presets" },
]) {
	for (const theme of ["light", "dark"] as const) {
		test(`${entry.name} screenshot in ${theme} theme`, async ({ page }) => {
			await page.setViewportSize({ width: 1440, height: 1024 });
			await setTheme(page, theme);
			await page.goto(`${baseURL}${entry.route}`, {
				waitUntil: "domcontentloaded",
			});
			await expect(page.locator("html")).toHaveClass(new RegExp(theme));
			await page.screenshot({
				path: resolve(screenshotDir, `${entry.name}-desktop-${theme}.png`),
				fullPage: true,
			});
		});
	}
}

for (const route of [
	"/caption-generator",
	"/auto-subtitle-generator",
	"/caption-presets",
	"/compare/capinsta-vs-kapwing",
	"/brand",
	"/sign-in",
	"/sign-up",
	"/forgot-password",
	"/reset-password",
]) {
	test(`${route} inherits dark theme`, async ({ page }) => {
		await setTheme(page, "dark");
		await page.goto(`${baseURL}${route}`, { waitUntil: "domcontentloaded" });
		await expect(page.locator("html")).toHaveClass(/dark/);
		await expect(page.locator("body")).not.toHaveCSS("background-color", "rgb(255, 255, 255)");
		await expect(page.locator("main")).toBeVisible();
	});
}

test("authentication pages are ad-free", async ({ page }) => {
	test.skip(
		process.env.CAPINSTA_UI_TEST_AUTH === "true",
		"Local editor E2E auth bypass redirects authenticated users away from auth pages.",
	);
	await page.goto(`${baseURL}/sign-in`, { waitUntil: "domcontentloaded" });
	await expect(page.locator("script[src*='googlesyndication']")).toHaveCount(0);
	await expect(page.locator(".adsbygoogle")).toHaveCount(0);
	await expect(page.locator("meta[name='robots']")).toHaveAttribute(
		"content",
		/noindex.*noarchive|noarchive.*noindex/,
	);
});

test("protected routes redirect before editor content renders", async ({ page }) => {
	test.skip(
		process.env.CAPINSTA_UI_TEST_AUTH === "true",
		"Local editor E2E auth bypass is enabled; run with a real staging app to verify redirects.",
	);
	for (const route of ["/projects", "/editor/private-project"]) {
		await page.goto(`${baseURL}${route}`, { waitUntil: "domcontentloaded" });
		await expect(page).toHaveURL(new RegExp(`/sign-in\\?redirect=`));
		await expect(page.locator(".editor-shell")).toHaveCount(0);
	}
});

test("favicon, manifest, ads.txt, sitemap and robots are valid public responses", async ({
	request,
}) => {
	const expectedTypes: Record<string, RegExp> = {
		"/favicon.ico": /image\/x-icon|image\/vnd\.microsoft\.icon/,
		"/logos/favicon/favicon-16x16.png": /image\/png/,
		"/logos/favicon/favicon-32x32.png": /image\/png/,
		"/logos/favicon/apple-touch-icon.png": /image\/png/,
		"/logos/favicon/android-chrome-192x192.png": /image\/png/,
		"/logos/favicon/android-chrome-512x512.png": /image\/png/,
		"/logos/favicon/site.webmanifest": /application\/manifest\+json|application\/json/,
		"/ads.txt": /text\/plain/,
	};
	for (const [path, contentType] of Object.entries(expectedTypes)) {
		const response = await request.get(`${baseURL}${path}`);
		expect(response.status(), path).toBe(200);
		expect(response.headers()["content-type"], path).toMatch(contentType);
	}

	const sitemap = await (await request.get(`${baseURL}/sitemap.xml`)).text();
	for (const privatePath of ["/editor", "/projects", "/sign-in", "/render"]) {
		expect(sitemap).not.toContain(privatePath);
	}
	expect(sitemap).not.toContain("localhost");

	const robots = await (await request.get(`${baseURL}/robots.txt`)).text();
	expect(robots).toContain("https://capinsta.huygenstudios.com/sitemap.xml");
	expect(robots).not.toContain("ads.txt");
});

test("AdSense remains disabled without real configuration", async ({ page }) => {
	await page.goto(baseURL, { waitUntil: "domcontentloaded" });
	await expect(page.locator("script[src*='googlesyndication']")).toHaveCount(0);
	await expect(page.locator(".adsense-region")).toHaveCount(0);
	await expect(page.locator(".adsense-placeholder")).toHaveCount(0);
});

test("internal renderer remains reachable and noindex", async ({ page }) => {
	const response = await page.goto(`${baseURL}/render`, {
		waitUntil: "domcontentloaded",
	});
	expect(response?.status()).toBe(200);
	await expect(page.locator("meta[name='robots']")).toHaveAttribute(
		"content",
		/noindex.*noarchive|noarchive.*noindex/,
	);
	await expect(page.locator("script[src*='googlesyndication']")).toHaveCount(0);
});
