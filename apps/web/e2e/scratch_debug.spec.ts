import { test, expect } from "@playwright/test";

test("diagnose projects list rendering crash", async ({ page }) => {
	// Set 60-second test timeout
	test.setTimeout(60000);

	// Set desktop viewport to prevent elements from being hidden by responsive design
	await page.setViewportSize({ width: 1920, height: 1080 });

	page.on("console", (msg) => {
		console.log(`BROWSER CONSOLE [${msg.type()}]:`, msg.text());
	});
	page.on("pageerror", (err) => {
		console.error("BROWSER PAGE ERROR:", err.message, err.stack);
	});
	page.on("requestfailed", (req) => {
		console.error("REQUEST FAILED:", req.method(), req.url(), req.failure()?.errorText);
	});
	page.on("response", (res) => {
		if (res.status() >= 400) {
			console.error(`HTTP RESPONSE ERROR [${res.status()}]:`, res.url());
		}
	});

	// Initialize theme and cookie consent
	await page.addInitScript(() => {
		localStorage.clear();
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

	// Go to projects
	console.log("Navigating to /projects...");
	await page.goto("http://127.0.0.1:3000/projects", { waitUntil: "domcontentloaded" });
	
	// Wait for store hydration
	console.log("Waiting for client-side hydration...");
	await expect(page.locator('button[aria-label="Grid view"][aria-pressed="true"]').first()).toBeVisible({ timeout: 15000 });
	
	// Create project
	console.log("Creating a new project...");
	await page.getByRole("button", { name: /^(New project|New)$/i }).first().click();
	
	// Wait for editor redirection
	console.log("Waiting for editor redirect...");
	await page.waitForURL(/\/editor\/[^/]+$/, { timeout: 15000 });
	await expect(page.locator(".editor-shell")).toBeVisible({ timeout: 15000 });
	console.log("Editor loaded successfully.");

	// Navigate back to /projects
	console.log("Navigating back to /projects...");
	await page.goto("http://127.0.0.1:3000/projects", { waitUntil: "domcontentloaded" });
	
	// Wait for store hydration again
	console.log("Waiting for projects list hydration...");
	await expect(page.locator('button[aria-label="Grid view"][aria-pressed="true"]').first()).toBeVisible({ timeout: 15000 });
	
	// Wait for project item to render
	console.log("Waiting for project items to render...");
	await page.waitForTimeout(3000);
	
	// Take screenshot of projects page with the project
	await page.screenshot({ path: "C:/Users/shrav/.gemini/antigravity-ide/brain/0b946ea0-7f8c-421e-b10c-97e954e394e2/scratch_projects_with_item.png" });
	
	// Get page body text
	const bodyText = await page.locator("body").innerText();
	console.log("PAGE BODY TEXT AFTER PROJECT CREATION:\n", bodyText);
});
