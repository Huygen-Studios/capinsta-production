import {
	findTemplateDefinition,
	normalizeTemplateSlotOrder,
	type MotionTemplateDefinition,
} from "@/templates";
import type {
	MotionTemplateElement,
	MotionTemplateSlotBinding,
} from "@/timeline";

export function buildResetTemplatePatch({
	definition,
	includeMedia,
}: {
	definition: MotionTemplateDefinition;
	includeMedia: boolean;
}): Partial<MotionTemplateElement> {
	return {
		templateParams: { ...definition.defaults },
		...(includeMedia
			? {
					slotBindings: emptySlotBindings({ definition }),
					slotOrder: normalizeTemplateSlotOrder({ definition }),
				}
			: {}),
	};
}

export function buildReplaceTemplatePatch({
	element,
	sourceDefinition,
	destinationTemplateId,
}: {
	element: MotionTemplateElement;
	sourceDefinition: MotionTemplateDefinition;
	destinationTemplateId: string;
}): Partial<MotionTemplateElement> | null {
	const destination = findTemplateDefinition({
		templateId: destinationTemplateId,
	});
	if (!destination) return null;
	const sourceOrder = normalizeTemplateSlotOrder({
		definition: sourceDefinition,
		slotOrder: element.slotOrder,
	});
	const orderedBindings = sourceOrder.map(
		(slotId) => element.slotBindings[slotId] ?? null,
	);
	return {
		templateId: destination.id,
		templateVersion: destination.version,
		name: destination.name,
		templateParams: { ...destination.defaults },
		slotBindings: Object.fromEntries(
			destination.mediaSlots.map((slot, index) => [
				slot.id,
				orderedBindings[index] ?? null,
			]),
		),
		slotOrder: normalizeTemplateSlotOrder({ definition: destination }),
	};
}

export function emptySlotBindings({
	definition,
}: {
	definition: MotionTemplateDefinition;
}): Record<string, MotionTemplateSlotBinding | null> {
	return Object.fromEntries(
		definition.mediaSlots.map((slot) => [slot.id, null]),
	);
}
