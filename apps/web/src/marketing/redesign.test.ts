import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getScrubModifier } from "@/components/ui/number-field";
import { getPublicPresetOrder } from "@/components/landing/preset-showcase";
import { CAPINSTA_CAPTION_PRESETS } from "@/capinsta/styles/presetRegistry";
import { buildArticleSchema, serializeJsonForHtml } from "@/components/structured-data";
import { SITE_URL } from "@/site/brand";

describe("ScrubbableNumberField modifiers", () => {
	test("supports standard, fast, precise, and combined movement", () => {
		expect(getScrubModifier({ shiftKey: false, altKey: false })).toBe(1);
		expect(getScrubModifier({ shiftKey: true, altKey: false })).toBe(10);
		expect(getScrubModifier({ shiftKey: false, altKey: true })).toBe(0.1);
		expect(getScrubModifier({ shiftKey: true, altKey: true })).toBe(1);
	});
});

describe("public preset registry", () => {
	test("shows the approved presets first without duplicating registry data", () => {
		const ordered = getPublicPresetOrder();
		expect(ordered.map(({ id }) => id).slice(0, 7)).toEqual([
			"word_highlight_box",
			"attention_punch",
			"apple_cinematic",
			"kinetic_fade",
			"mrbeast_style",
			"modern_minimalist_lockup",
			"dynamic_punch",
		]);
		expect(new Set(ordered.map(({ id }) => id))).toEqual(
			new Set(CAPINSTA_CAPTION_PRESETS.map(({ id }) => id)),
		);
	});
});

describe("production metadata assets", () => {
	test("uses production URLs in article JSON-LD", () => {
		const schema = buildArticleSchema({
			headline: "Capinsta comparison",
			description: "A factual comparison.",
			path: "/compare/capinsta-vs-kapwing",
			datePublished: "2026-06-21",
			dateModified: "2026-06-21",
		});
		expect(schema.url).toStartWith(SITE_URL);
		expect(JSON.stringify(schema)).not.toContain("localhost");
	});

	test("escapes JSON-LD so user text cannot break out of script tags", () => {
		const html = serializeJsonForHtml({
			headline: '</script><script>alert("xss")</script>',
			description: "line\u2028separator & more",
		});

		expect(html).not.toContain("</script>");
		expect(html).not.toContain("<script>");
		expect(html).not.toContain("&");
		expect(html).toContain("\\u003c/script\\u003e");
		expect(html).toContain("\\u2028");
	});

	test("manifest references only existing favicon files", () => {
		const publicDir = resolve(import.meta.dir, "../../public");
		const manifest: unknown = JSON.parse(
			readFileSync(
				resolve(publicDir, "logos/favicon/site.webmanifest"),
				"utf8",
			),
		);
		if (
			!manifest ||
			typeof manifest !== "object" ||
			!("name" in manifest) ||
			!("start_url" in manifest) ||
			!("icons" in manifest) ||
			!Array.isArray(manifest.icons)
		) {
			throw new Error("Invalid favicon manifest");
		}
		expect(manifest.name).toBe("Capinsta");
		expect(manifest.start_url).toBe("/");
		for (const icon of manifest.icons) {
			if (!icon || typeof icon !== "object" || !("src" in icon) || typeof icon.src !== "string") {
				throw new Error("Invalid manifest icon");
			}
			expect(existsSync(resolve(publicDir, icon.src.replace(/^\//, "")))).toBe(
				true,
			);
		}
	});
});
