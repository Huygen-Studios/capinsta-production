import { expect, test } from "@playwright/test";

const baseURL = process.env.CAPINSTA_QA_URL ?? "http://127.0.0.1:3000";
const onboardingKey = "capinsta-editor-onboarding:v1";

async function prepareNewUser(page: import("@playwright/test").Page) {
	await page.addInitScript((key) => {
		localStorage.setItem("theme", "dark");
		if (!sessionStorage.getItem("capinsta-editor-onboarding-test-ready")) {
			localStorage.removeItem(key);
			sessionStorage.setItem("capinsta-editor-onboarding-test-ready", "true");
		}
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

async function openEditor(page: import("@playwright/test").Page) {
	await page.goto(`${baseURL}/editor/onboarding-smoke`, {
		waitUntil: "domcontentloaded",
	});
	await page.waitForURL(/\/editor\/[^/]+$/, { timeout: 30_000 });
	await expect(page.locator(".editor-shell")).toBeVisible({ timeout: 30_000 });
}

test("editor guide runs once automatically and can be restarted manually", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await prepareNewUser(page);
	await openEditor(page);

	await expect(page.getByText("Welcome to Capinsta")).toBeVisible({
		timeout: 15_000,
	});
	await page.locator(".driver-popover-close-btn").click();
	await expect(page.getByText("Welcome to Capinsta")).toHaveCount(0);
	await expect
		.poll(() => page.evaluate((key) => localStorage.getItem(key), onboardingKey))
		.toBe("true");

	await page.reload({ waitUntil: "domcontentloaded" });
	await expect(page.locator(".editor-shell")).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText("Welcome to Capinsta")).toHaveCount(0);

	await page.getByRole("button", { name: "Start editor guide" }).click();
	await expect(page.getByText("Welcome to Capinsta")).toBeVisible({
		timeout: 5_000,
	});
});
