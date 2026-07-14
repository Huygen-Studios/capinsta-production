import { describe, expect, test } from "bun:test";
import {
	applyTemplateEasing,
	evaluateTemplateScene,
	normalizeTemplateSlotOrder,
	projectedCardScaleX,
	projectedCardScaleY,
	resolveTemplatePhase,
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
					expect(Number.isFinite(layer.rotationX)).toBe(true);
					expect(Number.isFinite(layer.rotationY)).toBe(true);
					expect(Number.isFinite(layer.opacity)).toBe(true);
				}
			}
		}
	});

	test("closes every template loop for forward and reverse duration presets", () => {
		for (const definition of templateDefinitions) {
			for (const direction of ["forward", "reverse"] as const) {
				for (const durationSeconds of [5, 10, 15]) {
					for (const cycleDuration of [5, 10, 15]) {
						const element = {
							templateId: definition.id,
							slotBindings: Object.fromEntries(
								definition.mediaSlots.map((slot) => [slot.id, null]),
							),
							slotOrder: definition.mediaSlots.map((slot) => slot.id),
							templateParams: {
								...definition.defaults,
								cycleDuration,
								direction,
							},
						};
						const atStart = evaluateTemplateScene({
							element,
							localTime: 0,
							durationSeconds,
						});
						const atEnd = evaluateTemplateScene({
							element,
							localTime: durationSeconds,
							durationSeconds,
						});
						expect(atEnd).toEqual(atStart);
					}
				}
			}
		}
	});

	test("keeps final-frame motion continuous with the first frame", () => {
		const durationSeconds = 5;
		const epsilon = 0.000_001;
		for (const definition of templateDefinitions) {
			for (const direction of ["forward", "reverse"] as const) {
				const element = {
					templateId: definition.id,
					slotBindings: Object.fromEntries(
						definition.mediaSlots.map((slot) => [slot.id, null]),
					),
					slotOrder: definition.mediaSlots.map((slot) => slot.id),
					templateParams: {
						...definition.defaults,
						direction,
					},
				};
				const beforeEnd = evaluateTemplateScene({
					element,
					localTime: durationSeconds - epsilon,
					durationSeconds,
				});
				const afterStart = evaluateTemplateScene({
					element,
					localTime: epsilon,
					durationSeconds,
				});
				const afterStartBySlot = new Map(
					afterStart.map((layer) => [layer.slotId, layer]),
				);
				for (const layer of beforeEnd) {
					const counterpart = afterStartBySlot.get(layer.slotId);
					expect(counterpart).toBeDefined();
					if (!counterpart) continue;
					const isContinuous = templateLayerRenderStateIsClose({
						first: layer,
						second: counterpart,
					});
					const boundaryIsSafe =
						isContinuous ||
						(templateLayerIsOutsideOrHidden({ layer }) &&
							templateLayerIsOutsideOrHidden({ layer: counterpart }));
					expect({
						templateId: definition.id,
						direction,
						slotId: layer.slotId,
						boundaryIsSafe,
					}).toEqual({
						templateId: definition.id,
						direction,
						slotId: layer.slotId,
						boundaryIsSafe: true,
					});
				}
			}
		}
	});

	test("resolves canonical phase values at loop boundaries", () => {
		for (const direction of ["forward", "reverse"] as const) {
			for (const durationSeconds of [5, 10, 15]) {
				expect(
					resolveTemplatePhase({
						localTime: 0,
						cycleDuration: 4,
						durationSeconds,
						direction,
					}),
				).toBe(0);
				expect(
					resolveTemplatePhase({
						localTime: durationSeconds,
						cycleDuration: 4,
						durationSeconds,
						direction,
					}),
				).toBe(0);
			}
		}
	});

	test("moves Card Totem continuously around a vertical 3D loop", () => {
		const definition = templateDefinitions.find(
			(item) => item.id === "card-totem",
		);
		expect(definition).toBeDefined();
		if (!definition) return;
		const element = {
			templateId: definition.id,
			slotBindings: Object.fromEntries(
				definition.mediaSlots.map((slot) => [slot.id, null]),
			),
			slotOrder: definition.mediaSlots.map((slot) => slot.id),
			templateParams: definition.defaults,
		};
		const atStart = evaluateTemplateScene({ element, localTime: 0 });
		const atEnd = evaluateTemplateScene({ element, localTime: 4 });
		const beforeEnd = evaluateTemplateScene({
			element,
			localTime: 4 - 0.000_001,
		});
		expect(atEnd).toEqual(atStart);
		const startBySlot = new Map(atStart.map((layer) => [layer.slotId, layer]));
		for (const layer of beforeEnd) {
			const startLayer = startBySlot.get(layer.slotId);
			expect(startLayer).toBeDefined();
			if (!startLayer) continue;
			expect(layer.x).toBeCloseTo(startLayer.x, 5);
			expect(layer.y).toBeCloseTo(startLayer.y, 5);
			expect(layer.scale).toBeCloseTo(startLayer.scale, 5);
			expect(layer.opacity).toBeCloseTo(startLayer.opacity, 5);
		}
		const bySlot = new Map(atStart.map((layer) => [layer.slotId, layer]));
		const front = bySlot.get("slot-1");
		const curvedEdge = bySlot.get("slot-3");
		expect(front).toBeDefined();
		expect(curvedEdge).toBeDefined();
		if (!front || !curvedEdge) return;
		expect(front.scale).toBeGreaterThan(curvedEdge.scale);
		expect(front.opacity).toBeGreaterThan(curvedEdge.opacity);
		expect(projectedCardScaleY({ rotationX: front.rotationX })).toBeCloseTo(1);
		expect(
			Math.abs(projectedCardScaleY({ rotationX: curvedEdge.rotationX })),
		).toBeLessThan(0.3);
	});

	test("orients Showcase Stream cards around its pitched 3D ring", () => {
		const definition = templateDefinitions.find(
			(item) => item.id === "showcase-stream",
		);
		expect(definition).toBeDefined();
		if (!definition) return;
		const layers = evaluateTemplateScene({
			element: {
				templateId: definition.id,
				slotBindings: Object.fromEntries(
					definition.mediaSlots.map((slot) => [slot.id, null]),
				),
				slotOrder: definition.mediaSlots.map((slot) => slot.id),
				templateParams: definition.defaults,
			},
			localTime: 0,
		});
		const bySlot = new Map(layers.map((layer) => [layer.slotId, layer]));
		const front = bySlot.get("slot-1");
		const side = bySlot.get("slot-3");
		const rear = bySlot.get("slot-5");
		expect(front).toBeDefined();
		expect(side).toBeDefined();
		expect(rear).toBeDefined();
		if (!front || !side || !rear) return;
		expect(front.rotationY).toBeCloseTo(0);
		expect(side.rotationY).toBeCloseTo(90);
		expect(rear.rotationY).toBeCloseTo(180);
		expect(front.y).toBeGreaterThan(side.y);
		expect(rear.y).toBeLessThan(side.y);
		expect(front.scale).toBeGreaterThan(rear.scale);
		expect(projectedCardScaleX({ rotationY: front.rotationY })).toBeCloseTo(1);
		expect(
			Math.abs(projectedCardScaleX({ rotationY: side.rotationY })),
		).toBeCloseTo(0);
		expect(projectedCardScaleX({ rotationY: rear.rotationY })).toBeCloseTo(-1);
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

type EvaluatedLayer = ReturnType<typeof evaluateTemplateScene>[number];

function templateLayerRenderStateIsClose({
	first,
	second,
}: {
	first: EvaluatedLayer;
	second: EvaluatedLayer;
}): boolean {
	const tolerance = 0.000_1;
	const values = [
		[first.x, second.x],
		[first.y, second.y],
		[first.z, second.z],
		[first.scale, second.scale],
		[first.opacity, second.opacity],
		[
			Math.cos((first.rotation * Math.PI) / 180),
			Math.cos((second.rotation * Math.PI) / 180),
		],
		[
			Math.sin((first.rotation * Math.PI) / 180),
			Math.sin((second.rotation * Math.PI) / 180),
		],
		[
			projectedCardScaleX({ rotationY: first.rotationY }),
			projectedCardScaleX({ rotationY: second.rotationY }),
		],
		[
			projectedCardScaleY({ rotationX: first.rotationX }),
			projectedCardScaleY({ rotationX: second.rotationX }),
		],
	];
	return values.every(([firstValue, secondValue]) =>
		Number.isFinite(firstValue) && Number.isFinite(secondValue)
			? Math.abs(firstValue - secondValue) <= tolerance
			: false,
	);
}

function templateLayerIsOutsideOrHidden({
	layer,
}: {
	layer: EvaluatedLayer;
}): boolean {
	if (layer.opacity <= 0.000_1) return true;
	const halfWidth = layer.scale / 2;
	const halfHeight = layer.scale / (2 * Math.max(0.1, layer.cardRatio));
	return (
		layer.x + halfWidth <= 0 ||
		layer.x - halfWidth >= 1 ||
		layer.y + halfHeight <= 0 ||
		layer.y - halfHeight >= 1
	);
}
