import { describe, expect, test } from "bun:test";

import { getTemplateDefinition } from "@/templates";
import { buildResetTemplatePatch } from "@/templates/instance-actions";

describe("motion template reset actions", () => {
	test("reset settings restores defaults while preserving media and slot order", () => {
		const definition = getTemplateDefinition({ templateId: "position-dance" });
		const patch = buildResetTemplatePatch({
			definition,
			includeMedia: false,
		});

		expect(patch).toEqual({
			templateParams: definition.defaults,
		});
		expect(patch.slotBindings).toBeUndefined();
		expect(patch.slotOrder).toBeUndefined();
	});

	test("reset all restores defaults, clears media, and restores canonical order", () => {
		const definition = getTemplateDefinition({ templateId: "position-dance" });
		const patch = buildResetTemplatePatch({
			definition,
			includeMedia: true,
		});

		expect(patch.templateParams).toEqual(definition.defaults);
		expect(patch.slotOrder).toEqual([
			"slot-1",
			"slot-2",
			"slot-3",
			"slot-4",
			"slot-5",
			"slot-6",
		]);
		expect(patch.slotBindings).toEqual({
			"slot-1": null,
			"slot-2": null,
			"slot-3": null,
			"slot-4": null,
			"slot-5": null,
			"slot-6": null,
		});
	});
});
