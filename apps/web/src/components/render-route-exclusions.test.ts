import { describe, expect, test } from "bun:test";
import { isRenderPath } from "./render-route-exclusions";

describe("isRenderPath", () => {
	test("excludes both Next and packaged render paths", () => {
		expect(isRenderPath("/render")).toBe(true);
		expect(isRenderPath("/render.html")).toBe(true);
		expect(isRenderPath("/render/internal")).toBe(true);
	});

	test("keeps application routes mounted", () => {
		expect(isRenderPath("/")).toBe(false);
		expect(isRenderPath("/editor/project-1")).toBe(false);
	});
});
