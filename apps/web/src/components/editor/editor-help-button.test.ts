import { describe, expect, test } from "bun:test";
import { getEditorHelpButtonAriaLabel } from "./editor-help-button";

describe("editor help button", () => {
	test("creates accessible labels for contextual help controls", () => {
		expect(getEditorHelpButtonAriaLabel("Timeline")).toBe("About Timeline");
		expect(getEditorHelpButtonAriaLabel("Media library")).toBe(
			"About Media library",
		);
	});
});
