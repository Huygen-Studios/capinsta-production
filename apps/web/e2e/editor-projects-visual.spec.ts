import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const baseURL = process.env.CAPINSTA_QA_URL ?? "http://127.0.0.1:3001";
const screenshotDir =
	process.env.CAPINSTA_QA_SCREENSHOTS ??
	resolve(process.env.TEMP ?? process.cwd(), "capinsta-ui-qa");
mkdirSync(screenshotDir, { recursive: true });

async function preparePage(page: Page, theme: "dark" | "light") {
	await page.addInitScript((selectedTheme) => {
		localStorage.setItem("theme", selectedTheme);
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
	}, theme);
}

async function openProjects(page: Page, theme: "dark" | "light") {
	await preparePage(page, theme);
	await page.goto(`${baseURL}/projects`, { waitUntil: "domcontentloaded" });
	await expect(
		page.getByRole("button", { name: /^(New project|New)$/i }),
	).toBeVisible({ timeout: 30_000 });
	await expect(page.locator("html")).toHaveClass(new RegExp(theme));
}

async function createProject(page: Page) {
	try {
		await page
			.getByRole("button", { name: "Create your first project" })
			.click({ timeout: 10_000 });
	} catch {
		await page.getByRole("button", { name: "New project" }).click();
	}
}

test("projects and editor render branded dark and light themes", async ({
	browser,
}) => {
	test.setTimeout(240_000);

	const darkContext = await browser.newContext({
		viewport: { width: 1920, height: 1080 },
	});
	const darkPage = await darkContext.newPage();
	await openProjects(darkPage, "dark");
	await darkPage.screenshot({
		path: resolve(screenshotDir, "projects-dark-1920x1080.png"),
		fullPage: true,
	});

	await createProject(darkPage);
	await darkPage.waitForURL(/\/editor\/[^/]+$/, { timeout: 30_000 });
	await expect(darkPage.getByRole("button", { name: /Export/i })).toBeVisible({
		timeout: 30_000,
	});
	if (await darkPage.getByText("Advertisement layout preview").first().isVisible()) {
		await expect(darkPage.locator(".editor-ad-rail")).toBeVisible();
	} else {
		await expect(darkPage.locator(".editor-ad-rail")).toBeHidden();
	}
	await darkPage.screenshot({
		path: resolve(screenshotDir, "editor-dark-1920x1080-ad-preview.png"),
	});

	await darkPage.setViewportSize({ width: 1366, height: 768 });
	await expect(darkPage.locator(".editor-ad-rail")).toBeHidden();
	await expect(darkPage.locator(".editor-top-ad")).toBeHidden();
	await darkPage.screenshot({
		path: resolve(screenshotDir, "editor-dark-1366x768.png"),
	});

	await darkPage.getByRole("button", { name: "Text" }).click();
	await expect(darkPage.getByText("Default text", { exact: true })).toBeVisible();
	const textCard = darkPage
		.locator("div.group.relative")
		.filter({ hasText: "Default text" });
	await textCard.locator("button").click({ force: true });
	await darkPage.getByRole("button", { name: "Transform" }).click();
	await expect(
		darkPage.getByRole("spinbutton", { name: "Position X" }),
	).toBeVisible({ timeout: 15_000 });
	const positionInput = darkPage.getByRole("spinbutton", { name: "Position X" });
	const positionUnit = positionInput
		.locator(
			"xpath=ancestor::div[contains(@class,'scrubbable-number-field')]",
		)
		.locator(".scrubbable-number-field__unit");
	const inputBox = await positionInput.boundingBox();
	const unitBox = await positionUnit.boundingBox();
	expect(inputBox).not.toBeNull();
	expect(unitBox).not.toBeNull();
	expect(inputBox!.x + inputBox!.width).toBeLessThanOrEqual(unitBox!.x + 0.5);
	await darkPage.screenshot({
		path: resolve(screenshotDir, "editor-position-field-corrected.png"),
	});

	const positionHandle = darkPage.getByRole("button", {
		name: "Scrub Position X",
	});
	const handleBox = await positionHandle.boundingBox();
	expect(handleBox).not.toBeNull();
	const scrubX = handleBox!.x + handleBox!.width / 2;
	const scrubY = handleBox!.y + handleBox!.height / 2;
	await darkPage.mouse.move(scrubX, scrubY);
	await darkPage.mouse.down();
	await darkPage.mouse.move(scrubX + 48, scrubY, { steps: 4 });
	await expect(positionInput).not.toHaveValue("0");
	await darkPage.screenshot({
		path: resolve(screenshotDir, "editor-position-x-active-scrub.png"),
	});
	await darkPage.mouse.up();
	await expect(positionInput).not.toHaveValue("0");

	await darkPage.goto(`${baseURL}/projects`, { waitUntil: "domcontentloaded" });
	await expect(darkPage.getByText("New project", { exact: true }).last()).toBeVisible();
	await darkPage.screenshot({
		path: resolve(screenshotDir, "projects-dark-grid-1920x1080.png"),
		fullPage: true,
	});
	await darkPage.locator(".project-card").first().hover();
	await darkPage.screenshot({
		path: resolve(screenshotDir, "projects-dark-grid-hover-1920x1080.png"),
		fullPage: true,
	});
	await darkContext.close();

	const lightContext = await browser.newContext({
		viewport: { width: 1920, height: 1080 },
	});
	const lightPage = await lightContext.newPage();
	await openProjects(lightPage, "light");
	await lightPage.screenshot({
		path: resolve(screenshotDir, "projects-light-1920x1080.png"),
		fullPage: true,
	});
	await createProject(lightPage);
	await lightPage.waitForURL(/\/editor\/[^/]+$/, { timeout: 30_000 });
	await expect(lightPage.getByRole("button", { name: /Export/i })).toBeVisible();
	await lightPage.screenshot({
		path: resolve(screenshotDir, "editor-light-1920x1080-ad-preview.png"),
	});
	await lightContext.close();

	const mobileContext = await browser.newContext({
		viewport: { width: 390, height: 844 },
	});
	const mobilePage = await mobileContext.newPage();
	await openProjects(mobilePage, "dark");
	await mobilePage.screenshot({
		path: resolve(screenshotDir, "projects-dark-mobile-390x844.png"),
		fullPage: true,
	});
	const mobileOverflow = await mobilePage.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
	);
	expect(mobileOverflow).toBeLessThanOrEqual(0);
	await mobileContext.close();
});
