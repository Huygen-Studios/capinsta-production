import {
	findTemplateDefinition,
	normalizeTemplateSlotOrder,
	type MotionTemplateDefinition,
} from "@/templates";

const mediaFits = new Set(["cover", "contain", "fill"]);
const playbackModes = new Set(["loop", "freeze", "trim"]);
const easingValues = new Set([
	"smooth",
	"snappy",
	"overshoot",
	"bounce",
	"elastic",
	"linear",
]);
const frameRatios = new Set(["project", "16:9", "4:3", "1:1", "4:5", "9:16"]);
const cardRatios = new Set(["1:1", "4:3", "3:4", "16:9", "9:16"]);

export function normalizeTemplateParams({
	definition,
	params,
}: {
	definition: MotionTemplateDefinition;
	params: unknown;
}): Record<string, unknown> {
	const sourceRecord = isRecord(params) ? params : {};
	const normalized = { ...definition.defaults };
	for (const parameter of definition.parameters) {
		const value = sourceRecord[parameter.id];
		if (parameter.type === "number") {
			normalized[parameter.id] = normalizeNumber({
				value,
				fallback: Number(parameter.default),
				min: parameter.min,
				max: parameter.max,
			});
		} else if (parameter.type === "boolean") {
			normalized[parameter.id] =
				typeof value === "boolean" ? value : parameter.default;
		} else if (parameter.type === "color") {
			normalized[parameter.id] =
				typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
					? value
					: parameter.default;
		} else if (parameter.type === "select") {
			normalized[parameter.id] = normalizeSelect({
				parameterId: parameter.id,
				value,
				fallback: String(parameter.default),
			});
		}
	}
	return normalized;
}

export function normalizeMotionTemplateElementRecord({
	element,
}: {
	element: Record<string, unknown>;
}): Record<string, unknown> {
	if (
		element.type !== "motion-template" ||
		typeof element.templateId !== "string"
	) {
		return element;
	}
	const definition = findTemplateDefinition({ templateId: element.templateId });
	if (!definition) {
		return {
			...element,
			templateVersion:
				typeof element.templateVersion === "number" &&
				Number.isFinite(element.templateVersion)
					? element.templateVersion
					: 0,
		};
	}

	return {
		...element,
		templateId: definition.id,
		templateVersion: definition.version,
		slotBindings: normalizeSlotBindings({
			definition,
			slotBindings: element.slotBindings,
		}),
		slotOrder: normalizeTemplateSlotOrder({
			definition,
			slotOrder: Array.isArray(element.slotOrder)
				? element.slotOrder
				: undefined,
		}),
		templateParams: normalizeTemplateParams({
			definition,
			params: element.templateParams,
		}),
	};
}

function normalizeSlotBindings({
	definition,
	slotBindings,
}: {
	definition: MotionTemplateDefinition;
	slotBindings: unknown;
}): Record<string, Record<string, unknown> | null> {
	const source = isRecord(slotBindings) ? slotBindings : {};
	return Object.fromEntries(
		definition.mediaSlots.map((slot) => [
			slot.id,
			normalizeSlotBinding({ value: source[slot.id] }),
		]),
	);
}

function normalizeSlotBinding({
	value,
}: {
	value: unknown;
}): Record<string, unknown> | null {
	if (!isRecord(value)) {
		return null;
	}
	if (typeof value.mediaId !== "string" || value.mediaId.length === 0) {
		return null;
	}
	const result: Record<string, unknown> = { mediaId: value.mediaId };
	const fit = parseMediaFit({ value: value.fit });
	if (fit !== null) {
		result.fit = fit;
	}
	const playbackMode = parsePlaybackMode({ value: value.playbackMode });
	if (playbackMode !== null) {
		result.playbackMode = playbackMode;
	}
	if (isRecord(value.crop)) {
		result.crop = {
			x: normalizeNumber({ value: value.crop.x, fallback: 0, min: -1, max: 1 }),
			y: normalizeNumber({ value: value.crop.y, fallback: 0, min: -1, max: 1 }),
			scale: normalizeNumber({
				value: value.crop.scale,
				fallback: 1,
				min: 0.25,
				max: 4,
			}),
		};
	}
	if (
		typeof value.sourceStart === "number" &&
		Number.isFinite(value.sourceStart)
	) {
		result.sourceStart = value.sourceStart;
	}
	if (typeof value.sourceEnd === "number" && Number.isFinite(value.sourceEnd)) {
		result.sourceEnd = value.sourceEnd;
	}
	return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMediaFit({ value }: { value: unknown }): string | null {
	return typeof value === "string" && mediaFits.has(value) ? value : null;
}

function parsePlaybackMode({ value }: { value: unknown }): string | null {
	return typeof value === "string" && playbackModes.has(value) ? value : null;
}

function normalizeSelect({
	parameterId,
	value,
	fallback,
}: {
	parameterId: string;
	value: unknown;
	fallback: string;
}): string {
	if (typeof value !== "string") return fallback;
	if (parameterId === "frameRatio")
		return frameRatios.has(value) ? value : fallback;
	if (parameterId === "cardRatio")
		return cardRatios.has(value) ? value : fallback;
	if (parameterId === "easing")
		return easingValues.has(value) ? value : fallback;
	if (parameterId === "direction") {
		return value === "forward" || value === "reverse" ? value : fallback;
	}
	return value;
}

function normalizeNumber({
	value,
	fallback,
	min,
	max,
}: {
	value: unknown;
	fallback: number;
	min?: number;
	max?: number;
}): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	const lower = min ?? Number.NEGATIVE_INFINITY;
	const upper = max ?? Number.POSITIVE_INFINITY;
	return Math.max(lower, Math.min(upper, value));
}
