import { describe, expect, test } from "bun:test";

import { getTemplateParameterCoverage, templateDefinitions } from "@/templates";

describe("motion template parameter coverage", () => {
	test("reports declared, consumed, and unconsumed parameters per template", () => {
		const byTemplate = Object.fromEntries(
			templateDefinitions.map((definition) => [
				definition.id,
				getTemplateParameterCoverage({ definition }),
			]),
		);

		for (const definition of templateDefinitions) {
			const coverage = byTemplate[definition.id];
			expect(coverage.declared).toEqual(
				definition.parameters.map((parameter) => parameter.id),
			);
			expect(coverage.undeclaredEvaluatorReads).toEqual([]);
			expect(coverage.rendererConsumed).toContain("frameRatio");
			expect(coverage.rendererConsumed).toContain("padding");
			expect(coverage.rendererConsumed).toContain("cornerRadius");
			expect(coverage.rendererConsumed).toContain("shadowEnabled");
			expect(coverage.unconsumed).toEqual([]);
		}

		expect(byTemplate["position-dance"].evaluatorConsumed).toContain(
			"movementAmplitude",
		);
		expect(byTemplate["position-dance"].evaluatorConsumed).toContain(
			"scaleContrast",
		);
		expect(byTemplate["position-dance"].evaluatorConsumed).toContain("easing");
		expect(byTemplate["film-strip"].evaluatorConsumed).toContain("spacing");
		expect(byTemplate["film-strip"].evaluatorConsumed).toContain(
			"rotationAmount",
		);
		expect(byTemplate["wheel-carousel"].evaluatorConsumed).toContain("spacing");
		expect(byTemplate["wheel-carousel"].evaluatorConsumed).toContain(
			"rotationAmount",
		);
		expect(byTemplate["ticker-loop"].evaluatorConsumed).toContain("spacing");
		expect(byTemplate["ticker-loop"].evaluatorConsumed).toContain(
			"rotationAmount",
		);
	});
});
