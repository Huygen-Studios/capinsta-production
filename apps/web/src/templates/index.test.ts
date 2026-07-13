import { describe, expect, test } from "bun:test";
import {
	applyTemplateEasing,
	evaluateTemplateScene,
	normalizeTemplateSlotOrder,
	templateDefinitions,
} from "@/templates";

describe("motion template registry", () => {
	test("registers fourteen valid definitions", () => {
		expect(templateDefinitions).toHaveLength(14);
		expect(new Set(templateDefinitions.map((item) => item.id)).size).toBe(14);
		const positionDance = templateDefinitions.find(
			(item) => item.id === "position-dance",
		);
		expect(positionDance?.mediaSlots).toHaveLength(6);
		for (const definition of templateDefinitions) {
			expect(definition.version).toBeGreaterThan(0);
			expect(definition.defaultDuration).toBeGreaterThan(0);
			expect(new Set(definition.mediaSlots.map((slot) => slot.id)).size).toBe(
				definition.mediaSlots.length,
			);
		}
	});

	test("easing presets are finite and deterministic", () => {
		for (const easing of [
			"smooth",
			"snappy",
			"overshoot",
			"bounce",
			"elastic",
			"linear",
		]) {
			expect(applyTemplateEasing({ value: 0, easing })).toBe(0);
			expect(applyTemplateEasing({ value: 1, easing })).toBe(1);
			for (const value of [0.25, 0.5, 0.75]) {
				const first = applyTemplateEasing({ value, easing });
				const second = applyTemplateEasing({ value, easing });
				expect(Number.isFinite(first)).toBe(true);
				expect(first).toBe(second);
			}
		}
	});

	test("evaluates all templates with finite layers", () => {
		for (const definition of templateDefinitions) {
			const element = {
				templateId: definition.id,
				slotBindings: Object.fromEntries(
					definition.mediaSlots.map((slot) => [slot.id, null]),
				),
				slotOrder: definition.mediaSlots.map((slot) => slot.id),
				templateParams: definition.defaults,
			};
			for (const localTime of [0, 1, 2, 3.999, 4]) {
				const layers = evaluateTemplateScene({ element, localTime });
				expect(layers).toHaveLength(definition.mediaSlots.length);
				for (const layer of layers) {
					expect(Number.isFinite(layer.x)).toBe(true);
					expect(Number.isFinite(layer.y)).toBe(true);
					expect(Number.isFinite(layer.z)).toBe(true);
					expect(Number.isFinite(layer.scale)).toBe(true);
					expect(Number.isFinite(layer.rotation)).toBe(true);
					expect(Number.isFinite(layer.opacity)).toBe(true);
				}
			}
		}
	});

	test("normalizes slot order without mutating input", () => {
		const definition = templateDefinitions.find(
			(item) => item.id === "position-dance",
		);
		expect(definition).toBeDefined();
		if (!definition) return;
		const input = ["slot-3", "unknown", "slot-3", "slot-1"];
		const output = normalizeTemplateSlotOrder({ definition, slotOrder: input });
		expect(input).toEqual(["slot-3", "unknown", "slot-3", "slot-1"]);
		expect(output).toEqual([
			"slot-3",
			"slot-1",
			"slot-2",
			"slot-4",
			"slot-5",
			"slot-6",
		]);
	});
});
