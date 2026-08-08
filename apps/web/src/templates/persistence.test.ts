import { describe, expect, test } from "bun:test";
import {
	evaluateTemplateScene,
	getTemplateDefinition,
	normalizeMotionTemplateElementRecord,
} from "@/templates";

const ticks = ({ seconds }: { seconds: number }) => seconds * 120_000;

describe("motion template persistence normalization", () => {
	test("round-trips position dance semantics through JSON", () => {
		const definition = getTemplateDefinition({ templateId: "position-dance" });
		const element = {
			id: "template-1",
			type: "motion-template" as const,
			name: definition.name,
			templateId: definition.id,
			templateVersion: definition.version,
			duration: ticks({ seconds: definition.defaultDuration }),
			startTime: ticks({ seconds: 1 }),
			trimStart: 0,
			trimEnd: 0,
			params: {},
			slotOrder: ["slot-3", "slot-1", "slot-2", "slot-4", "slot-5", "slot-6"],
			slotBindings: {
				"slot-1": {
					mediaId: "image-1",
					fit: "cover" as const,
					crop: { x: 0.1, y: -0.1, scale: 1.2 },
				},
				"slot-2": {
					mediaId: "video-1",
					fit: "contain" as const,
					playbackMode: "freeze" as const,
					sourceStart: ticks({ seconds: 1 }),
					sourceEnd: ticks({ seconds: 3 }),
				},
				"slot-3": null,
				"slot-4": null,
				"slot-5": null,
				"slot-6": null,
			},
			templateParams: {
				...definition.defaults,
				background: "#123456",
				cycleDuration: 5,
				cardRatio: "16:9",
				easing: "bounce",
				shadowEnabled: true,
			},
		};
		const loaded = normalizeMotionTemplateElementRecord({
			element: JSON.parse(JSON.stringify(element)) as Record<string, unknown>,
		});
		expect(loaded.templateId).toBe(element.templateId);
		expect(loaded.templateVersion).toBe(element.templateVersion);
		expect(loaded.slotOrder).toEqual(element.slotOrder);
		expect(loaded.slotBindings).toEqual(element.slotBindings);
		expect(loaded.templateParams).toEqual(element.templateParams);
		expect(evaluateTemplateScene({ element, localTime: 1.25 })).toEqual(
			evaluateTemplateScene({
				element: loaded as Parameters<
					typeof evaluateTemplateScene
				>[0]["element"],
				localTime: 1.25,
			}),
		);
	});
});
