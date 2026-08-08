import { describe, expect, test } from "bun:test";
import {
	evaluateTemplateScene,
	moveTemplateSlot,
	moveTemplateSlotById,
	normalizeTemplateSlotOrder,
	templateDefinitions,
} from "@/templates";

const definition = templateDefinitions.find(
	(item) => item.id === "position-dance",
);
if (!definition) throw new Error("position-dance definition missing");

describe("motion template slot order", () => {
	test("defaults to canonical order and normalizes malformed order", () => {
		expect(normalizeTemplateSlotOrder({ definition })).toEqual([
			"slot-1",
			"slot-2",
			"slot-3",
			"slot-4",
			"slot-5",
			"slot-6",
		]);
		expect(
			normalizeTemplateSlotOrder({
				definition,
				slotOrder: ["slot-3", "bad", "slot-3", "slot-1"],
			}),
		).toEqual(["slot-3", "slot-1", "slot-2", "slot-4", "slot-5", "slot-6"]);
	});

	test("moves slots without mutating the source order", () => {
		const order = ["slot-1", "slot-2", "slot-3", "slot-4", "slot-5", "slot-6"];
		const moved = moveTemplateSlotById({
			definition,
			slotOrder: order,
			slotId: "slot-1",
			direction: "down",
		});
		expect(order).toEqual([
			"slot-1",
			"slot-2",
			"slot-3",
			"slot-4",
			"slot-5",
			"slot-6",
		]);
		expect(moved).toEqual([
			"slot-2",
			"slot-1",
			"slot-3",
			"slot-4",
			"slot-5",
			"slot-6",
		]);
	});

	test("moves slots by source and destination index for pointer reordering", () => {
		const order = ["slot-1", "slot-2", "slot-3", "slot-4", "slot-5", "slot-6"];
		expect(
			moveTemplateSlot({
				slotOrder: order,
				sourceIndex: 2,
				destinationIndex: 0,
			}),
		).toEqual(["slot-3", "slot-1", "slot-2", "slot-4", "slot-5", "slot-6"]);
		expect(
			moveTemplateSlot({
				slotOrder: order,
				sourceIndex: 2,
				destinationIndex: 5,
			}),
		).toEqual(["slot-1", "slot-2", "slot-4", "slot-5", "slot-6", "slot-3"]);
		expect(order).toEqual([
			"slot-1",
			"slot-2",
			"slot-3",
			"slot-4",
			"slot-5",
			"slot-6",
		]);
	});

	test("pointer reorder cancellation and invalid targets leave order unchanged", () => {
		const order = ["slot-1", "slot-2", "slot-3"];
		expect(
			moveTemplateSlot({
				slotOrder: order,
				sourceIndex: 1,
				destinationIndex: 1,
			}),
		).toEqual(order);
		expect(
			moveTemplateSlot({
				slotOrder: order,
				sourceIndex: -1,
				destinationIndex: 1,
			}),
		).toEqual(order);
		expect(
			moveTemplateSlot({
				slotOrder: order,
				sourceIndex: 1,
				destinationIndex: 9,
			}),
		).toEqual(order);
	});

	test("reordering preserves complete bindings because bindings remain keyed by slot", () => {
		const bindings = {
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
		};
		const nextOrder = moveTemplateSlot({
			slotOrder: ["slot-1", "slot-2", "slot-3"],
			sourceIndex: 2,
			destinationIndex: 0,
		});
		expect(nextOrder).toEqual(["slot-3", "slot-1", "slot-2"]);
		expect(bindings["slot-3"]).toEqual({
			mediaId: "video-b",
			fit: "cover",
			crop: { x: -0.3, y: 0.2, scale: 2 },
			playbackMode: "freeze",
			sourceStart: 120,
			sourceEnd: 360,
		});
		expect(bindings["slot-1"]).toEqual({
			mediaId: "image-a",
			fit: "contain",
			crop: { x: 0.1, y: -0.2, scale: 1.4 },
			playbackMode: "loop",
		});
	});

	test("evaluator respects instance order", () => {
		const baseElement = {
			templateId: definition.id,
			slotBindings: Object.fromEntries(
				definition.mediaSlots.map((slot) => [slot.id, null]),
			),
			slotOrder: ["slot-1", "slot-2", "slot-3", "slot-4", "slot-5", "slot-6"],
			templateParams: definition.defaults,
		};
		const reorderedElement = {
			...baseElement,
			slotOrder: ["slot-3", "slot-1", "slot-2", "slot-4", "slot-5", "slot-6"],
		};
		const base = evaluateTemplateScene({ element: baseElement, localTime: 0 });
		const reordered = evaluateTemplateScene({
			element: reorderedElement,
			localTime: 0,
		});
		expect(base.map((layer) => layer.slotId)).not.toEqual(
			reordered.map((layer) => layer.slotId),
		);
		expect(reordered.map((layer) => layer.slotId)).toContain("slot-3");
	});
});
