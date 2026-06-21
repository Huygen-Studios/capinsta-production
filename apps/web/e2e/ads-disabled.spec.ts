import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const baseURL = process.env.CAPINSTA_QA_URL ?? "http://127.0.0.1:3003";
const screenshotDir =
	process.env.CAPINSTA_QA_SCREENSHOTS ??
	resolve(process.env.TEMP ?? process.cwd(), "capinsta-ui-qa");
mkdirSync(screenshotDir, { recursive: true });

test("disabled ads reserve no editor space", async ({ page }) => {
	test.setTimeout(120_000);
	await page.addInitScript(() => {
		localStorage.setItem("theme", "dark");
		localStorage.setItem("hasSeenOnboarding", "true");
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
	await page.setViewportSize({ width: 1920, height: 1080 });
	await page.goto(`${baseURL}/projects`, { waitUntil: "domcontentloaded" });
	await page.getByRole("button", { name: "New project" }).click();
	await page.waitForURL(/\/editor\/[^/]+$/, { timeout: 30_000 });
	await expect(page.getByRole("button", { name: /Export/i })).toBeVisible();
	await expect(page.getByText("Advertisement layout preview")).toHaveCount(0);
	await expect(page.locator(".editor-top-ad")).toBeHidden();
	await expect(page.locator(".editor-ad-rail")).toBeHidden();
	await expect(page.locator(".editor-workspace-with-ads")).toHaveCSS(
		"grid-template-columns",
		"1920px",
	);
	await page.screenshot({
		path: resolve(screenshotDir, "editor-dark-1920x1080-ads-disabled.png"),
	});
});
