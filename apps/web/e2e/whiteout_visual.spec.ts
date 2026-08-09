import { test, expect } from "@playwright/test";
import { execSync } from "child_process";
import * as fs from "fs";

const baseURL = process.env.CAPINSTA_QA_URL ?? "http://127.0.0.1:3000";
const onboardingKey = "capinsta-editor-onboarding:v1";

async function prepareNewUser(page: import("@playwright/test").Page) {
	await page.addInitScript((key) => {
		localStorage.clear();
		localStorage.setItem("theme", "dark");
		localStorage.setItem("hasSeenOnboarding", "true");
		localStorage.setItem(key, "true");
		localStorage.setItem(
			"capinsta-cookie-consent",
			JSON.stringify({
				necessary: true,
				analytics: false,
				advertising: false,
				updatedAt: new Date().toISOString(),
			}),
		);
	}, onboardingKey);
}

test("verify whiteout editorial caption preset selection, override, persistence, and export", async ({ page }) => {
	// 120 second timeout for this full visual E2E flow
	test.setTimeout(120000);
	
	// Desktop viewport to match standard E2E configuration
	await page.setViewportSize({ width: 1920, height: 1080 });

	page.on("console", (msg) => {
		console.log(`BROWSER CONSOLE [${msg.type()}]:`, msg.text());
	});
	page.on("pageerror", (err) => {
		console.error("BROWSER PAGE ERROR:", err.message, err.stack);
	});

	// Mock the runtime config API to enable sample caption import even under UI test auth bypass
	await page.route("**/api/runtime-config", async (route) => {
		console.log("Mocking /api/runtime-config route...");
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				flags: {
					sample_import_enabled: true,
					advertisements_enabled: false,
				},
			}),
		});
	});

	// Proxy backend calls to the local api server to bypass CORS and log 422 errors
	await page.route("http://127.0.0.1:8000/**", async (route) => {
		const request = route.request();
		console.log(`CORS Proxying local: ${request.method()} ${request.url()}`);
		try {
			const headers = { ...request.headers() };
			delete headers["host"];
			const response = await page.request.fetch(request, {
				headers,
			});
			if (response.status() === 422) {
				console.log(`422 response body for ${request.url()}:`, await response.text());
			}
			await route.fulfill({
				response,
				headers: {
					...response.headers(),
					"Access-Control-Allow-Origin": "*",
					"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
					"Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
				},
			});
		} catch (err) {
			console.error(`CORS Proxying local failed for ${request.url()}:`, err);
			await route.abort();
		}
	});

	await prepareNewUser(page);
	
	console.log("Navigating to onboarding-smoke editor...");
	await page.goto(`${baseURL}/editor/onboarding-smoke`, {
		waitUntil: "domcontentloaded",
	});
	
	console.log("Waiting for redirection to editor project...");
	await page.waitForURL(/\/editor\/[^/]+$/, { timeout: 30000 });
	await expect(page.locator(".editor-shell")).toBeVisible({ timeout: 30000 });
	console.log("Editor loaded successfully.");

	// Wait for any onboarding guide popup and close it if it appears
	try {
		await page.locator(".driver-popover-close-btn").click({ timeout: 5000 });
		console.log("Closed onboarding guide popup.");
	} catch {
		console.log("Onboarding guide popover was not displayed.");
	}

	// Open Captions panel on the left sidebar
	console.log("Opening Captions panel on left sidebar...");
	await page.getByRole("button", { name: "Captions" }).click({ timeout: 15000 });

	// Click Import Sample Captions
	console.log("Importing sample captions...");
	await page.getByRole("button", { name: "Import Sample Captions" }).click({ timeout: 15000 });

	// Wait for timeline captions element to be visible
	console.log("Waiting for timeline captions element...");
	await expect(page.locator('[data-timeline-element="true"]').first()).toBeVisible({ timeout: 20000 });

	// Select the captions timeline element
	console.log("Selecting timeline captions element...");
	await page.locator('[data-timeline-element="true"]').first().click({ timeout: 15000 });
	
	// Click Effect Controls tab in right properties sidebar
	console.log("Switching properties sidebar to Effect Controls...");
	await page.getByRole("button", { name: "Effect Controls" }).click({ timeout: 15000 });
	
	// Let initial render settle
	await page.waitForTimeout(2000);
	
	// Take screenshot of initial style state
	console.log("Capturing initial style state screenshot...");
	await page.getByTestId("editor-preview-canvas").screenshot({
		path: "C:/Users/shrav/.gemini/antigravity-ide/brain/0b946ea0-7f8c-421e-b10c-97e954e394e2/initial_canvas.png"
	});

	// Select Whiteout Editorial preset
	console.log("Applying Whiteout Editorial caption preset...");
	await page.getByRole("button").filter({ hasText: "Whiteout Editorial" }).click({ timeout: 15000 });
	await page.waitForTimeout(2000);
	
	// Take screenshot of Whiteout Editorial
	console.log("Capturing Whiteout Editorial preset screenshot...");
	await page.getByTestId("editor-preview-canvas").screenshot({
		path: "C:/Users/shrav/.gemini/antigravity-ide/brain/0b946ea0-7f8c-421e-b10c-97e954e394e2/whiteout_preset.png"
	});

	// Change font family override to Poppins
	console.log("Changing font override to Poppins...");
	await page.locator('label:has-text("Font")').locator('select').selectOption("Poppins");
	await page.waitForTimeout(2000);
	
	// Take screenshot of Poppins override
	console.log("Capturing Poppins font override screenshot...");
	await page.getByTestId("editor-preview-canvas").screenshot({
		path: "C:/Users/shrav/.gemini/antigravity-ide/brain/0b946ea0-7f8c-421e-b10c-97e954e394e2/whiteout_font_changed.png"
	});

	// Change Y layout position to 85%
	console.log("Changing Y position layout override to 85%...");
	await page.getByRole("slider", { name: "Y", exact: true }).fill("85");
	await page.waitForTimeout(2000);
	
	// Take screenshot of Y position override
	console.log("Capturing Y position layout override screenshot...");
	await page.getByTestId("editor-preview-canvas").screenshot({
		path: "C:/Users/shrav/.gemini/antigravity-ide/brain/0b946ea0-7f8c-421e-b10c-97e954e394e2/whiteout_position_changed.png"
	});

	// Reload the editor page to test project persistence
	console.log("Reloading editor page to verify persistence...");
	await page.reload({ waitUntil: "domcontentloaded" });
	await expect(page.locator(".editor-shell")).toBeVisible({ timeout: 30000 });
	
	// Select the captions timeline element again
	console.log("Reselecting timeline captions element after reload...");
	await page.locator('[data-timeline-element="true"]').first().click({ timeout: 15000 });
	await page.getByRole("button", { name: "Effect Controls" }).click({ timeout: 15000 });
	await page.waitForTimeout(2000);
	
	// Take persisted state screenshot
	console.log("Capturing persisted style state screenshot...");
	await page.getByTestId("editor-preview-canvas").screenshot({
		path: "C:/Users/shrav/.gemini/antigravity-ide/brain/0b946ea0-7f8c-421e-b10c-97e954e394e2/whiteout_persisted_after_reload.png"
	});

	// Verify persistence checks
	const fontValue = await page.locator('label:has-text("Font")').locator('select').inputValue();
	console.log(`PERSISTED FONT VALUE: ${fontValue}`);
	expect(fontValue).toBe("Poppins");

	const ySliderValue = await page.getByRole("slider", { name: "Y", exact: true }).inputValue();
	console.log(`PERSISTED Y SLIDER VALUE: ${ySliderValue}`);
	expect(ySliderValue).toBe("85");

	// Trigger Export and Download the video
	console.log("Opening Export dialog...");
	await page.getByRole("button", { name: "Export", exact: true }).click({ timeout: 15000 });
	await expect(page.getByRole("button", { name: "Export Full Video" })).toBeVisible({ timeout: 15000 });
	
	console.log("Starting export download process...");
	const downloadPromise = page.waitForEvent("download", { timeout: 120000 });
	await page.getByRole("button", { name: "Export Full Video" }).click({ timeout: 15000 });
	const download = await downloadPromise;
	
	const exportPath = "C:/Users/shrav/.gemini/antigravity-ide/brain/0b946ea0-7f8c-421e-b10c-97e954e394e2/capinsta_export_whiteout.mp4";
	await download.saveAs(exportPath);
	console.log(`Exported video saved to: ${exportPath}`);
	
	// Verify file exists and has size > 0
	const stats = fs.statSync(exportPath);
	console.log(`Exported file size: ${stats.size} bytes`);
	expect(stats.size).toBeGreaterThan(0);
});
