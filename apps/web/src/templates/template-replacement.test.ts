import { describe, expect, test } from "bun:test";

import { getTemplateDefinition } from "@/templates";
import { buildReplaceTemplatePatch } from "@/templates/instance-actions";
import type { MotionTemplateElement } from "@/timeline";

function elementFor({
	templateId,
}: {
	templateId: string;
}): MotionTemplateElement {
	const definition = getTemplateDefinition({ templateId });
	return {
		id: "template-1",
		type: "motion-template",
		name: definition.name,
		start: 120,
		duration: 840,
		templateId: definition.id,
		templateVersion: definition.version,
		slotOrder: ["slot-3", "slot-1", "slot-2", "slot-4", "slot-5", "slot-6"],
		slotBindings: {
			"slot-1": {
				mediaId: "image-a",
				fit: "contain",
				crop: { x: 0.1, y: -0.2, scale: 1.4 },
				playbackMode: "loop",
			},
			"slot-2": null,
			"slot-3": {
				mediaId: "video-b",
				fit: "cover",
				crop: { x: -0.3, y: 0.2, scale: 2 },
				playbackMode: "freeze",
				sourceStart: 120,
				sourceEnd: 360,
			},
			"slot-4": { mediaId: "image-c", fit: "fill", playbackMode: "trim" },
			"slot-5": null,
			"slot-6": { mediaId: "image-d", fit: "cover" },
		},
		templateParams: {
			...definition.defaults,
			background: "#ffffff",
			cardSize: 0.5,
		},
	};
}

describe("motion template replacement", () => {
	test("transfers bindings in visible sequence to fewer-slot destination", () => {
		const sourceDefinition = getTemplateDefinition({
			templateId: "position-dance",
		});
		const destination = getTemplateDefinition({ templateId: "carousel-flow" });
		const patch = buildReplaceTemplatePatch({
			element: elementFor({ templateId: "position-dance" }),
			sourceDefinition,
			destinationTemplateId: destination.id,
		});

		expect(patch).not.toBeNull();
		expect(patch?.templateId).toBe(destination.id);
		expect(patch?.templateVersion).toBe(destination.version);
		expect(patch?.templateParams).toEqual(destination.defaults);
		expect(patch?.slotOrder).toEqual([
			"slot-1",
			"slot-2",
			"slot-3",
			"slot-4",
			"slot-5",
		]);
		expect(patch?.slotBindings?.["slot-1"]).toEqual({
			mediaId: "video-b",
			fit: "cover",
			crop: { x: -0.3, y: 0.2, scale: 2 },
			playbackMode: "freeze",
			sourceStart: 120,
			sourceEnd: 360,
		});
		expect(patch?.slotBindings?.["slot-2"]).toEqual({
			mediaId: "image-a",
			fit: "contain",
			crop: { x: 0.1, y: -0.2, scale: 1.4 },
			playbackMode: "loop",
		});
		expect(patch?.slotBindings?.["slot-3"]).toBeNull();
	});

	test("adds empty destination slots when replacing with a larger template", () => {
		const sourceDefinition = getTemplateDefinition({
			templateId: "carousel-flow",
		});
		const source = elementFor({ templateId: "position-dance" });
		const patch = buildReplaceTemplatePatch({
			element: {
				...source,
				templateId: "carousel-flow",
				slotOrder: ["slot-1", "slot-2", "slot-3", "slot-4", "slot-5"],
			},
			sourceDefinition,
			destinationTemplateId: "position-dance",
		});

		expect(patch?.slotOrder).toEqual([
			"slot-1",
			"slot-2",
			"slot-3",
			"slot-4",
			"slot-5",
			"slot-6",
		]);
		expect(patch?.slotBindings?.["slot-6"]).toBeNull();
	});

	test("rejects unknown destination IDs safely", () => {
		const sourceDefinition = getTemplateDefinition({
			templateId: "position-dance",
		});
		expect(
			buildReplaceTemplatePatch({
				element: elementFor({ templateId: "position-dance" }),
				sourceDefinition,
				destinationTemplateId: "missing-template",
			}),
		).toBeNull();
	});
});
