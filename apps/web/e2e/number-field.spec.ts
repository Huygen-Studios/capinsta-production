import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";

const baseURL = process.env.CAPINSTA_QA_URL ?? "http://127.0.0.1:3000";
const screenshotDir =
	process.env.CAPINSTA_QA_SCREENSHOTS ??
	resolve(process.env.TEMP ?? process.cwd(), "capinsta-number-field-qa");
mkdirSync(screenshotDir, { recursive: true });
test.setTimeout(60_000);

test.beforeEach(async ({ page }) => {
	await page.goto(`${baseURL}/internal/ui-verification`, {
		waitUntil: "domcontentloaded",
	});
	await expect(
		page.getByRole("heading", { name: "Scrubbable number verification" }),
	).toBeVisible();
	await expect(page.locator("main[data-hydrated]")).toHaveAttribute(
		"data-hydrated",
		"true",
	);
});

test("value and unit occupy separate non-overlapping columns", async ({ page }) => {
	for (const label of [
		"Position X",
		"Negative position",
		"Large position",
		"Opacity zero",
		"Opacity full",
		"Rotation",
	]) {
		const input = page.getByRole("spinbutton", { name: label });
		const field = input.locator("xpath=ancestor::div[contains(@class,'scrubbable-number-field')]");
		const unit = field.locator(".scrubbable-number-field__unit");
		const inputBox = await input.boundingBox();
		const unitBox = await unit.boundingBox();
		expect(inputBox, label).not.toBeNull();
		expect(unitBox, label).not.toBeNull();
		expect(inputBox!.x + inputBox!.width, label).toBeLessThanOrEqual(unitBox!.x + 0.5);
	}
	await page.screenshot({
		path: resolve(screenshotDir, "number-field-units.png"),
		fullPage: true,
	});
});

test("normal click selects without changing the value", async ({ page }) => {
	const input = page.getByRole("spinbutton", { name: "Position X" });
	await input.click();
	await expect(input).toHaveValue("0");
	await expect(input).toBeFocused();
});

test("real pointer drag scrubs, captures outside, and commits once", async ({ page }) => {
	const handle = page.getByRole("button", { name: "Scrub Position X" });
	const input = page.getByRole("spinbutton", { name: "Position X" });
	const box = await handle.boundingBox();
	expect(box).not.toBeNull();
	const startX = box!.x + box!.width / 2;
	const startY = box!.y + box!.height / 2;
	await page.mouse.move(startX, startY);
	await expect(handle).toHaveCSS("cursor", "ew-resize");
	await page.mouse.down();
	await expect(page.getByTestId("gesture-counts")).toContainText("Starts: 1");
	await page.mouse.move(startX + 2, startY, { steps: 1 });
	await expect(input).toHaveValue("0");
	await page.mouse.move(startX + 90, startY, { steps: 6 });
	await expect(page.getByTestId("gesture-counts")).not.toContainText("updates: 0");
	await expect(input).not.toHaveValue("0");
	await expect(input.locator("xpath=ancestor::div[contains(@class,'scrubbable-number-field')]")).toHaveAttribute("data-scrubbing", "true");
	await page.screenshot({
		path: resolve(screenshotDir, "number-field-active-scrub.png"),
		fullPage: true,
	});
	await page.mouse.move(1200, 700);
	await page.mouse.up();
	await expect(page.getByTestId("commit-count")).toContainText("1");
	expect(await page.evaluate(() => document.body.style.cursor)).toBe("");
	expect(await page.evaluate(() => document.body.style.userSelect)).toBe("");
});

test("Shift is faster, Alt is precise, and Escape restores the original value", async ({
	page,
}) => {
	const handle = page.getByRole("button", { name: "Scrub Position X" });
	const input = page.getByRole("spinbutton", { name: "Position X" });
	const box = await handle.boundingBox();
	expect(box).not.toBeNull();

	await page.keyboard.down("Shift");
	await page.mouse.move(box!.x + 10, box!.y + 10);
	await page.mouse.down();
	await page.mouse.move(box!.x + 30, box!.y + 10);
	await page.mouse.up();
	await page.keyboard.up("Shift");
	const fastValue = Number(await input.inputValue());
	expect(fastValue).toBeGreaterThan(20);

	await input.fill("0");
	await input.blur();
	await page.keyboard.down("Alt");
	await page.mouse.move(box!.x + 10, box!.y + 10);
	await page.mouse.down();
	await page.mouse.move(box!.x + 30, box!.y + 10);
	await page.mouse.up();
	await page.keyboard.up("Alt");
	const preciseValue = Number(await input.inputValue());
	expect(preciseValue).toBeGreaterThan(0);
	expect(preciseValue).toBeLessThan(fastValue);

	await input.fill("0");
	await input.blur();
	await page.mouse.move(box!.x + 10, box!.y + 10);
	await page.mouse.down();
	await page.mouse.move(box!.x + 100, box!.y + 10);
	await page.keyboard.press("Escape");
	await expect(input).toHaveValue("0");
	await page.mouse.up();
});

test("typing, arrows, invalid text, empty state, and reset stay safe", async ({
	page,
}) => {
	const input = page.getByRole("spinbutton", { name: "Decimal" });
	await input.fill("2.5");
	await input.press("Enter");
	await expect(input).toHaveValue("2.5");
	await input.press("ArrowUp");
	await expect(input).toHaveValue("2.51");
	await input.press("Shift+ArrowDown");
	await expect(input).toHaveValue("2.41");

	await input.fill("");
	await expect(input).toHaveValue("");
	await input.blur();
	await expect(input).toHaveValue("0.25");

	await input.fill("not-a-number");
	await input.blur();
	await expect(input).toHaveValue("0.25");

	const handle = page.getByRole("button", { name: "Scrub Decimal" });
	await handle.dblclick();
	await expect(input).toHaveValue("0.25");
});
