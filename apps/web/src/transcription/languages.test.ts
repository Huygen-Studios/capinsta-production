import { describe, expect, test } from "bun:test";
import { LANGUAGES } from "./languages";

describe("caption language options", () => {
	test("contains only supported Capinsta languages", () => {
		expect(LANGUAGES.map((language) => language.name)).toEqual([
			"English",
			"Hindi",
			"Telugu",
			"Hinglish",
			"Telgish (Telugu + English)",
		]);
		expect(LANGUAGES.map((language) => language.name)).not.toContain("Spanish");
		expect(LANGUAGES.map((language) => language.name)).not.toContain("Italian");
		expect(LANGUAGES.map((language) => language.name)).not.toContain("French");
		expect(LANGUAGES.map((language) => language.name)).not.toContain("German");
		expect(LANGUAGES.map((language) => language.name)).not.toContain("Portuguese");
		expect(LANGUAGES.map((language) => language.name)).not.toContain("Russian");
		expect(LANGUAGES.map((language) => language.name)).not.toContain("Japanese");
		expect(LANGUAGES.map((language) => language.name)).not.toContain("Chinese");
	});
});
