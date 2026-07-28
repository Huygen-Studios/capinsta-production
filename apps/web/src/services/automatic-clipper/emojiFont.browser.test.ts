import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const CHROMIUM_PATHS = [
	process.env.CAPINSTA_CHROMIUM_EXECUTABLE,
	"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
	"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter((value): value is string => Boolean(value));

describe("automatic hook emoji font", () => {
	test("renders multi-codepoint emoji from the bundled font in Chromium", () => {
		const executablePath = CHROMIUM_PATHS.find(existsSync);
		if (!executablePath) throw new Error("Chrome or Edge is required");
		const script = String.raw`
			import { chromium } from "@playwright/test";
			import { readFileSync } from "node:fs";
			const input = JSON.parse(readFileSync(0, "utf8"));
			const browser = await chromium.launch({ executablePath: input.executablePath, headless: true });
			const page = await browser.newPage({ viewport: { width: 600, height: 240 } });
			await page.route("https://capinsta.test/NotoColorEmoji.ttf", route =>
				route.fulfill({ body: readFileSync(input.fontPath), contentType: "font/ttf" }));
			await page.setContent('<style>@font-face{font-family:HookEmoji;src:url(https://capinsta.test/NotoColorEmoji.ttf)}#hook{font:72px HookEmoji}</style><div id="hook">👨🏽‍💻 ❤️</div>');
			await page.waitForFunction(() => document.fonts.check('72px "HookEmoji"'));
			const result = await page.locator("#hook").evaluate(element => ({
				text: element.textContent,
				width: element.getBoundingClientRect().width,
				height: element.getBoundingClientRect().height,
			}));
			await browser.close();
			console.log(JSON.stringify(result));
		`;
		const result = spawnSync("node", ["--input-type=module", "-e", script], {
			cwd: process.cwd(),
			encoding: "utf8",
			input: JSON.stringify({
				executablePath,
				fontPath: path.join(
					process.cwd(),
					"public",
					"emoji-fonts",
					"NotoColorEmoji.ttf",
				),
			}),
			timeout: 45_000,
		});
		expect(result.error).toBeUndefined();
		expect(result.status, result.stderr).toBe(0);
		const rendered: unknown = JSON.parse(result.stdout.trim());
		if (!rendered || typeof rendered !== "object") {
			throw new Error("Chromium returned an invalid result");
		}
		expect(Reflect.get(rendered, "text")).toBe("👨🏽‍💻 ❤️");
		expect(Reflect.get(rendered, "width")).toBeGreaterThan(0);
		expect(Reflect.get(rendered, "height")).toBeGreaterThan(60);
	}, 60_000);
});
