import { describe, expect, test } from "bun:test";
import { createMotionTemplateDragData } from "@/templates/drag";
import { templateDefinitions } from "@/templates";

describe("motion template drag/default element", () => {
	test("creates a typed drag payload", () => {
		const definition = templateDefinitions[0];
		const payload = createMotionTemplateDragData({ definition });
		expect(payload).toEqual({
			type: "motion-template",
			id: definition.id,
			name: definition.name,
			templateId: definition.id,
			templateVersion: definition.version,
		});
	});

	test("definition provides default element inputs", () => {
		const definition = templateDefinitions.find(
			(item) => item.id === "position-dance",
		);
		expect(definition).toBeDefined();
		if (!definition) return;
		expect(definition.defaultDuration).toBe(5);
		expect(definition.defaults.cycleDuration).toBe(4);
		expect(definition.mediaSlots.map((slot) => slot.id)).toEqual([
			"slot-1",
			"slot-2",
			"slot-3",
			"slot-4",
			"slot-5",
			"slot-6",
		]);
	});
});
