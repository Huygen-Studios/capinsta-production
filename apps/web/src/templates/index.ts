import type { MotionTemplateElement } from "@/timeline";

export type TemplateCategory =
	| "3d-perspective"
	| "carousel-flow"
	| "stack-scatter";

export type TemplateMediaFit = "cover" | "contain" | "fill";
export type TemplatePlaybackMode = "loop" | "freeze" | "trim";
export type TemplateFrameRatio =
	| "project"
	| "16:9"
	| "4:3"
	| "1:1"
	| "4:5"
	| "9:16";
export type TemplateCardRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16";

export type TemplateParameterDefinition = {
	id: string;
	label: string;
	group: "frame" | "timing" | "layout" | "appearance" | "easing" | "shadow";
	type: "number" | "color" | "select" | "boolean";
	default: string | number | boolean;
	min?: number;
	max?: number;
	step?: number;
	unit?: string;
	options?: Array<{ label: string; value: string }>;
};

export type MotionTemplateDefinition = {
	id: string;
	version: number;
	name: string;
	description: string;
	category: TemplateCategory;
	defaultDuration: number;
	allowSlotReorder: boolean;
	mediaSlots: Array<{ id: string; label: string }>;
	defaults: Record<string, unknown>;
	parameters: TemplateParameterDefinition[];
};

export type TemplateLayer = {
	slotId: string;
	x: number;
	y: number;
	z: number;
	scale: number;
	rotation: number;
	rotationX: number;
	rotationY: number;
	opacity: number;
	cardRatio: number;
};

const aspectRatios = ["16:9", "4:3", "1:1", "4:5", "9:16"] as const;
const cardRatios = ["1:1", "4:3", "3:4", "16:9", "9:16"] as const;

const commonParameters: TemplateParameterDefinition[] = [
	{
		id: "frameRatio",
		label: "Frame",
		group: "frame",
		type: "select",
		default: "project",
		options: [
			{ label: "Project canvas", value: "project" },
			...aspectRatios.map((value) => ({ label: value, value })),
		],
	},
	{
		id: "cycleDuration",
		label: "Loop duration",
		group: "timing",
		type: "number",
		default: 4,
		min: 1,
		max: 15,
		step: 0.25,
		unit: "s",
	},
	{
		id: "direction",
		label: "Direction",
		group: "timing",
		type: "select",
		default: "forward",
		options: [
			{ label: "Forward", value: "forward" },
			{ label: "Reverse", value: "reverse" },
		],
	},
	{
		id: "backgroundEnabled",
		label: "Background",
		group: "appearance",
		type: "boolean",
		default: false,
	},
	{
		id: "background",
		label: "Background colour",
		group: "appearance",
		type: "color",
		default: "#101014",
	},
	{
		id: "padding",
		label: "Padding",
		group: "appearance",
		type: "number",
		default: 0.06,
		min: 0,
		max: 0.3,
		step: 0.01,
	},
	{
		id: "cornerRadius",
		label: "Corner radius",
		group: "appearance",
		type: "number",
		default: 0.04,
		min: 0,
		max: 0.5,
		step: 0.01,
	},
	{
		id: "cardSize",
		label: "Card size",
		group: "layout",
		type: "number",
		default: 0.28,
		min: 0.08,
		max: 0.72,
		step: 0.01,
	},
	{
		id: "spacing",
		label: "Spacing",
		group: "layout",
		type: "number",
		default: 0.08,
		min: 0,
		max: 0.35,
		step: 0.01,
	},
	{
		id: "cardRatio",
		label: "Card ratio",
		group: "layout",
		type: "select",
		default: "1:1",
		options: cardRatios.map((value) => ({ label: value, value })),
	},
	{
		id: "rotationAmount",
		label: "Rotation amount",
		group: "layout",
		type: "number",
		default: 8,
		min: 0,
		max: 45,
		step: 1,
	},
	{
		id: "easing",
		label: "Easing",
		group: "easing",
		type: "select",
		default: "smooth",
		options: [
			"smooth",
			"snappy",
			"overshoot",
			"bounce",
			"elastic",
			"linear",
		].map((value) => ({ label: value, value })),
	},
	{
		id: "shadowEnabled",
		label: "Shadow",
		group: "shadow",
		type: "boolean",
		default: false,
	},
	{
		id: "shadowColor",
		label: "Shadow colour",
		group: "shadow",
		type: "color",
		default: "#000000",
	},
	{
		id: "shadowOpacity",
		label: "Shadow opacity",
		group: "shadow",
		type: "number",
		default: 0.3,
		min: 0,
		max: 1,
		step: 0.05,
	},
	{
		id: "shadowBlur",
		label: "Shadow blur",
		group: "shadow",
		type: "number",
		default: 12,
		min: 0,
		max: 64,
		step: 1,
	},
	{
		id: "shadowOffsetX",
		label: "Shadow X",
		group: "shadow",
		type: "number",
		default: 0,
		min: -64,
		max: 64,
		step: 1,
	},
	{
		id: "shadowOffsetY",
		label: "Shadow Y",
		group: "shadow",
		type: "number",
		default: 12,
		min: -64,
		max: 64,
		step: 1,
	},
];

const positionDanceParameters: TemplateParameterDefinition[] = [
	{
		id: "movementAmplitude",
		label: "Movement amplitude",
		group: "layout",
		type: "number",
		default: 1,
		min: 0,
		max: 2,
		step: 0.05,
	},
	{
		id: "scaleContrast",
		label: "Scale contrast",
		group: "layout",
		type: "number",
		default: 1,
		min: 0,
		max: 2,
		step: 0.05,
	},
];

const alwaysEvaluatedParameterIds = new Set([
	"cycleDuration",
	"direction",
	"cardSize",
	"cardRatio",
]);

const spacingTemplateIds = new Set([
	"showcase-stream",
	"orbit-carousel",
	"photo-orbit",
	"stack-slide",
	"cascade-drop",
	"image-trail",
	"position-dance",
	"film-strip",
	"carousel-flow",
	"ticker-loop",
	"column-drift",
	"wheel-carousel",
]);

const easingTemplateIds = new Set([
	"wheel-carousel",
	"poster-burst",
	"position-dance",
]);

const rotationTemplateIds = new Set([
	"showcase-stream",
	"orbit-carousel",
	"card-totem",
	"photo-orbit",
	"position-dance",
	"poster-burst",
	"stack-slide",
	"cascade-drop",
	"image-trail",
	"film-strip",
	"carousel-flow",
	"ticker-loop",
	"column-drift",
	"wheel-carousel",
]);

const rendererParameterIds = new Set([
	"frameRatio",
	"backgroundEnabled",
	"background",
	"padding",
	"cornerRadius",
	"shadowEnabled",
	"shadowColor",
	"shadowOpacity",
	"shadowBlur",
	"shadowOffsetX",
	"shadowOffsetY",
]);

const catalog = [
	[
		"showcase-stream",
		"Showcase Stream",
		"Cards bend around a tilted 3D ring.",
		"3d-perspective",
		8,
	],
	[
		"card-totem",
		"Card Totem",
		"A vertical 3D-curved strip of cards moving through the centre.",
		"3d-perspective",
		7,
	],
	[
		"film-strip",
		"Film Strip",
		"A curved 3D band of cards gliding through the centre.",
		"3d-perspective",
		8,
	],
	[
		"orbit-carousel",
		"Orbit Carousel",
		"Cards orbit with simulated depth while the front card receives focus.",
		"3d-perspective",
		5,
	],
	[
		"photo-orbit",
		"Photo Orbit",
		"A cluster of cards slowly orbits around the centre.",
		"carousel-flow",
		6,
	],
	[
		"wheel-carousel",
		"Wheel Carousel",
		"Cards advance around a large wheel with anticipation and overshoot.",
		"carousel-flow",
		8,
	],
	[
		"carousel-flow",
		"Carousel Flow",
		"A gliding belt of cards where the centred card receives focus.",
		"carousel-flow",
		5,
	],
	[
		"ticker-loop",
		"Ticker Loop",
		"Opposing tilted marquee rows move continuously.",
		"carousel-flow",
		8,
	],
	[
		"column-drift",
		"Column Drift",
		"Three card columns move vertically in alternating directions.",
		"carousel-flow",
		9,
	],
	[
		"stack-slide",
		"Stack Slide",
		"Cards slide upward over one another with a spring-style landing.",
		"stack-scatter",
		5,
	],
	[
		"cascade-drop",
		"Cascade Drop",
		"Cards fall into a loose stack and then sweep away.",
		"stack-scatter",
		6,
	],
	[
		"image-trail",
		"Image Trail",
		"Cards appear along a curved trail and fade or melt away.",
		"stack-scatter",
		7,
	],
	[
		"poster-burst",
		"Poster Burst",
		"Images burst outward from the centre and grow to cover the previous card.",
		"stack-scatter",
		6,
	],
	[
		"position-dance",
		"Position Dance",
		"Cards cycle through defined positions and scales in a seamless loop.",
		"stack-scatter",
		6,
	],
] as const;

export const templateDefinitions: MotionTemplateDefinition[] = catalog.map(
	([id, name, description, category, slotCount]) => ({
		id,
		name,
		description,
		category,
		version: 2,
		defaultDuration: 5,
		allowSlotReorder: true,
		mediaSlots: Array.from({ length: slotCount }, (_, index) => ({
			id: `slot-${index + 1}`,
			label: `Slot ${index + 1}`,
		})),
		defaults: {
			frameRatio: "project",
			backgroundEnabled: false,
			background: "#101014",
			padding: 0.06,
			cornerRadius: 0.04,
			cardSize: 0.28,
			spacing: 0.08,
			cardRatio: "1:1",
			cycleDuration: 4,
			direction: "forward",
			easing: "smooth",
			shadowEnabled: false,
			shadowColor: "#000000",
			shadowOpacity: 0.3,
			shadowBlur: 12,
			shadowOffsetX: 0,
			shadowOffsetY: 12,
			movementAmplitude: 1,
			scaleContrast: 1,
			rotationAmount: 8,
		},
		parameters: templateParametersFor({ templateId: id }),
	}),
);

function templateParametersFor({
	templateId,
}: {
	templateId: (typeof catalog)[number][0];
}): TemplateParameterDefinition[] {
	const supported = new Set([
		"frameRatio",
		"cycleDuration",
		"direction",
		"backgroundEnabled",
		"background",
		"padding",
		"cornerRadius",
		"cardSize",
		"cardRatio",
		"shadowEnabled",
		"shadowColor",
		"shadowOpacity",
		"shadowBlur",
		"shadowOffsetX",
		"shadowOffsetY",
	]);
	if (spacingTemplateIds.has(templateId)) supported.add("spacing");
	if (rotationTemplateIds.has(templateId)) supported.add("rotationAmount");
	if (easingTemplateIds.has(templateId)) supported.add("easing");
	return [
		...commonParameters.filter((parameter) => supported.has(parameter.id)),
		...(templateId === "position-dance" ? positionDanceParameters : []),
	];
}

export function getTemplateParameterCoverage({
	definition,
}: {
	definition: MotionTemplateDefinition;
}): {
	declared: string[];
	evaluatorConsumed: string[];
	rendererConsumed: string[];
	unconsumed: string[];
	undeclaredEvaluatorReads: string[];
} {
	const declared = definition.parameters.map((parameter) => parameter.id);
	const declaredSet = new Set(declared);
	const evaluatorConsumed = [
		...alwaysEvaluatedParameterIds,
		...(spacingTemplateIds.has(definition.id) ? ["spacing"] : []),
		...(easingTemplateIds.has(definition.id) ? ["easing"] : []),
		...(rotationTemplateIds.has(definition.id) ? ["rotationAmount"] : []),
		...(definition.id === "position-dance"
			? ["movementAmplitude", "scaleContrast"]
			: []),
	].filter((parameterId) => declaredSet.has(parameterId));
	const rendererConsumed = [...rendererParameterIds].filter((parameterId) =>
		declaredSet.has(parameterId),
	);
	const consumed = new Set([...evaluatorConsumed, ...rendererConsumed]);
	return {
		declared,
		evaluatorConsumed,
		rendererConsumed,
		unconsumed: declared.filter((parameterId) => !consumed.has(parameterId)),
		undeclaredEvaluatorReads: evaluatorConsumed.filter(
			(parameterId) => !declaredSet.has(parameterId),
		),
	};
}

export function findTemplateDefinition({
	templateId,
}: {
	templateId: string;
}): MotionTemplateDefinition | null {
	return templateDefinitions.find((item) => item.id === templateId) ?? null;
}

export function getTemplateDefinition({
	templateId,
}: {
	templateId: string;
}): MotionTemplateDefinition {
	const definition = findTemplateDefinition({ templateId });
	if (!definition) throw new Error(`Unknown motion template: ${templateId}`);
	return definition;
}

export function normalizeTemplateSlotOrder({
	definition,
	slotOrder,
}: {
	definition: MotionTemplateDefinition;
	slotOrder?: readonly string[] | null;
}): string[] {
	const canonical = definition.mediaSlots.map((slot) => slot.id);
	if (!Array.isArray(slotOrder)) return canonical;
	const validIds = new Set(canonical);
	const seen = new Set<string>();
	const normalized: string[] = [];
	for (const slotId of slotOrder) {
		if (!validIds.has(slotId) || seen.has(slotId)) continue;
		seen.add(slotId);
		normalized.push(slotId);
	}
	for (const slotId of canonical) {
		if (!seen.has(slotId)) normalized.push(slotId);
	}
	return normalized;
}

export function moveTemplateSlotById({
	definition,
	slotOrder,
	slotId,
	direction,
}: {
	definition: MotionTemplateDefinition;
	slotOrder?: readonly string[] | null;
	slotId: string;
	direction: "up" | "down";
}): string[] {
	const normalized = normalizeTemplateSlotOrder({ definition, slotOrder });
	if (!definition.allowSlotReorder) return normalized;
	const index = normalized.indexOf(slotId);
	if (index < 0) return normalized;
	const target = direction === "up" ? index - 1 : index + 1;
	if (target < 0 || target >= normalized.length) return normalized;
	const next = [...normalized];
	const [moved] = next.splice(index, 1);
	next.splice(target, 0, moved);
	return next;
}

export function moveTemplateSlot({
	slotOrder,
	sourceIndex,
	destinationIndex,
}: {
	slotOrder: readonly string[];
	sourceIndex: number;
	destinationIndex: number;
}): string[] {
	const next = [...slotOrder];
	if (
		sourceIndex < 0 ||
		sourceIndex >= next.length ||
		destinationIndex < 0 ||
		destinationIndex >= next.length ||
		sourceIndex === destinationIndex
	) {
		return next;
	}
	const [moved] = next.splice(sourceIndex, 1);
	next.splice(destinationIndex, 0, moved);
	return next;
}

export function positiveModulo({
	value,
	divisor,
}: {
	value: number;
	divisor: number;
}): number {
	if (!Number.isFinite(value) || !Number.isFinite(divisor) || divisor <= 0)
		return 0;
	return ((value % divisor) + divisor) % divisor;
}

export function applyTemplateEasing({
	value,
	easing,
}: {
	value: number;
	easing: unknown;
}): number {
	const t = Math.max(0, Math.min(1, value));
	if (t === 0 || t === 1) return t;
	switch (easing) {
		case "linear":
			return t;
		case "snappy":
			return t * t * (3 - 2 * t);
		case "overshoot":
			return 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;
		case "bounce":
			return t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 2 / 2;
		case "elastic":
			return (
				2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1
			);
		default:
			return t * t * (3 - 2 * t);
	}
}

export function evaluateTemplateScene({
	element,
	localTime,
	durationSeconds,
}: {
	element: Pick<
		MotionTemplateElement,
		"templateId" | "slotBindings" | "slotOrder" | "templateParams"
	>;
	localTime: number;
	durationSeconds?: number;
}): TemplateLayer[] {
	const definition = findTemplateDefinition({ templateId: element.templateId });
	if (!definition) return [];
	const duration = readNumber({
		value: element.templateParams.cycleDuration,
		fallback: 4,
		min: 0.1,
		max: 60,
	});
	const phase = resolveTemplatePhase({
		localTime,
		cycleDuration: duration,
		durationSeconds,
		direction: element.templateParams.direction,
	});
	const slotMap = new Map(definition.mediaSlots.map((slot) => [slot.id, slot]));
	const slots = normalizeTemplateSlotOrder({
		definition,
		slotOrder: element.slotOrder,
	})
		.map((slotId) => slotMap.get(slotId))
		.filter((slot): slot is (typeof definition.mediaSlots)[number] =>
			Boolean(slot),
		);

	return slots
		.map((slot, index) =>
			evaluateLayer({
				templateId: definition.id,
				index,
				count: slots.length,
				phase,
				slotId: slot.id,
				params: element.templateParams,
			}),
		)
		.sort((a, b) => a.z - b.z || a.slotId.localeCompare(b.slotId));
}

function evaluateLayer({
	templateId,
	index,
	count,
	phase,
	slotId,
	params,
}: {
	templateId: string;
	index: number;
	count: number;
	phase: number;
	slotId: string;
	params: Record<string, unknown>;
}): TemplateLayer {
	const n = Math.max(1, count);
	const tau = Math.PI * 2;
	const t = phase * tau;
	const angle = t + (index * tau) / n;
	const cardSize = readNumber({
		value: params.cardSize,
		fallback: 0.28,
		min: 0.08,
		max: 0.72,
	});
	const spacing = readNumber({
		value: params.spacing,
		fallback: 0.08,
		min: 0,
		max: 0.35,
	});
	const rotationAmount = readNumber({
		value: params.rotationAmount,
		fallback: 8,
		min: 0,
		max: 45,
	});
	const cardRatio = ratioValue({ value: params.cardRatio });
	let x = 0.5;
	let y = 0.5;
	let z = 0;
	let scale = cardSize;
	let rotation = 0;
	let rotationX = 0;
	let rotationY = 0;
	let opacity = 1;

	if (templateId === "showcase-stream") {
		// Project a horizontal 3D ring pitched toward the viewer. Each card's
		// Y rotation follows its radial angle so side cards become edge-on.
		z = Math.cos(angle);
		x += Math.sin(angle) * (0.24 + spacing);
		y += z * (0.12 + spacing * 0.5);
		scale *= 0.72 + (z + 1) * 0.18;
		opacity = 0.48 + (z + 1) * 0.24;
		rotation = Math.sin(angle) * rotationAmount;
		rotationY = (angle * 180) / Math.PI;
	} else if (templateId === "orbit-carousel") {
		x += Math.cos(angle) * (0.24 + spacing);
		y += Math.sin(angle) * (0.1 + spacing);
		z = Math.sin(angle);
		scale *= 0.65 + (z + 1) * 0.28;
		opacity = 0.45 + (z + 1) * 0.27;
		rotation = Math.cos(angle) * rotationAmount;
	} else if (templateId === "card-totem") {
		const verticalRadius = 0.38 + spacing * 0.35;
		z = Math.cos(angle);
		x = 0.5;
		y = 0.5 + Math.sin(angle) * verticalRadius;
		const perspectiveScale = 1 / (1 - z * 0.18);
		scale *= perspectiveScale;
		opacity = ((z + 1) / 2) ** 1.5;
		rotation = Math.sin(angle) * rotationAmount;
		rotationX = (angle * 180) / Math.PI;
	} else if (["film-strip", "carousel-flow"].includes(templateId)) {
		const p = positiveModulo({ value: phase + index / n, divisor: 1 });
		x = p * (1.2 + spacing * 1.8) - (0.1 + spacing);
		y = 0.5 + Math.sin(p * Math.PI) * 0.08;
		z = Math.sin(p * Math.PI);
		scale *= 0.72 + Math.sin(p * Math.PI) * 0.35;
		rotation = Math.cos(p * tau) * rotationAmount;
	} else if (templateId === "photo-orbit") {
		const variant = deterministicUnit({ index });
		const orbitAngle = angle + variant * tau;
		x += Math.cos(orbitAngle) * (0.16 + spacing);
		y += Math.sin(orbitAngle) * (0.14 + spacing * 0.5);
		z = Math.sin(orbitAngle);
		scale *= 0.75 + variant * 0.45;
		rotation = Math.sin(orbitAngle) * rotationAmount;
	} else if (templateId === "wheel-carousel") {
		const stepped = Math.floor(phase * n);
		const sub = applyTemplateEasing({
			value: positiveModulo({ value: phase * n, divisor: 1 }),
			easing: params.easing,
		});
		const wheelAngle = ((index - stepped - sub) * tau) / n - Math.PI / 2;
		const wheelRadius = 0.34 + spacing;
		x = 0.5 + Math.cos(wheelAngle) * wheelRadius;
		y = 0.82 + Math.sin(wheelAngle) * (wheelRadius + 0.06);
		z = -Math.sin(wheelAngle);
		scale *= 0.65 + (z + 1) * 0.22;
		rotation = ((wheelAngle * 180) / Math.PI + 90) * (rotationAmount / 8);
	} else if (templateId === "ticker-loop") {
		const row = index % 2;
		const p = positiveModulo({
			value: phase * (row === 0 ? 1 : -1) + index / Math.ceil(n / 2),
			divisor: 1,
		});
		x = p * (1.25 + spacing * 2.5) - (0.12 + spacing);
		y = 0.35 + row * (0.22 + spacing);
		scale *= 0.78;
		rotation = row === 0 ? rotationAmount : -rotationAmount;
	} else if (templateId === "column-drift") {
		const column = index % 3;
		x = 0.5 + (column - 1) * (0.18 + spacing);
		const columnProgress = positiveModulo({
			value:
				phase * (column === 1 ? 1 : -1) +
				Math.floor(index / 3) * (0.26 + spacing),
			divisor: 1,
		});
		const verticalBuffer = cardSize + spacing * 2;
		y = columnProgress * (1 + verticalBuffer * 2) - verticalBuffer;
		scale *= 0.75 + deterministicUnit({ index }) * 0.2;
		rotation = (column - 1) * rotationAmount;
	} else if (templateId === "position-dance") {
		const amplitude = readNumber({
			value: params.movementAmplitude,
			fallback: 1,
			min: 0,
			max: 2,
		});
		const scaleContrast = readNumber({
			value: params.scaleContrast,
			fallback: 1,
			min: 0,
			max: 2,
		});
		const positions = [
			[0.25, 0.28, 0.18],
			[0.5, 0.5, 0.32],
			[0.76, 0.3, 0.18],
			[0.26, 0.72, 0.18],
			[0.72, 0.72, 0.18],
			[0.5, 0.22, 0.15],
		];
		const slotPhase = phase * n + index;
		const currentIndex = Math.floor(slotPhase) % positions.length;
		const nextIndex = (currentIndex + 1) % positions.length;
		const transition = applyTemplateEasing({
			value: positiveModulo({ value: slotPhase, divisor: 1 }),
			easing: params.easing,
		});
		const current = positions[currentIndex];
		const next = positions[nextIndex];
		const anchor = [
			lerp({ start: current[0], end: next[0], amount: transition }),
			lerp({ start: current[1], end: next[1], amount: transition }),
			lerp({ start: current[2], end: next[2], amount: transition }),
		];
		const spread = amplitude + spacing * 2;
		x = 0.5 + (anchor[0] - 0.5) * spread;
		y = 0.5 + (anchor[1] - 0.5) * spread;
		scale = cardSize * (anchor[2] / 0.28) * (0.75 + scaleContrast * 0.25);
		rotation = Math.sin(t + index) * rotationAmount;
		z = scale;
	} else if (templateId === "poster-burst") {
		const p = positiveModulo({ value: phase * n - index, divisor: n }) / n;
		x = 0.5 + (deterministicUnit({ index }) - 0.5) * 0.14;
		y = 0.5 + (deterministicUnit({ index: index + 9 }) - 0.5) * 0.14;
		scale *=
			0.25 + applyTemplateEasing({ value: p, easing: params.easing }) * 2.4;
		rotation = (deterministicUnit({ index }) - 0.5) * rotationAmount * 2;
		opacity = Math.min(1, p * 10, (1 - p) * 10);
		z = p;
	} else {
		const p = positiveModulo({ value: phase - index / n, divisor: 1 });
		x = 0.5 + Math.sin(t + index * 1.7) * (0.12 + spacing);
		y =
			templateId === "image-trail"
				? 0.24 + p * 0.48 - Math.sin(p * Math.PI) * 0.2
				: 0.5 + (p - 0.5) * 0.42;
		scale *= 0.5 + p * 0.75;
		rotation = (index - n / 2) * 4 + Math.sin(p * tau) * rotationAmount;
		opacity = Math.min(1, p * 5, (1 - p) * 5);
		z = p;
	}

	return {
		slotId,
		x,
		y,
		z,
		scale,
		rotation,
		rotationX,
		rotationY,
		opacity,
		cardRatio,
	};
}

export function resolveTemplatePhase({
	localTime,
	cycleDuration,
	durationSeconds,
	direction,
}: {
	localTime: number;
	cycleDuration: number;
	durationSeconds?: number;
	direction: unknown;
}): number {
	const safeLocalTime = Number.isFinite(localTime) ? localTime : 0;
	const safeCycleDuration =
		Number.isFinite(cycleDuration) && cycleDuration > 0 ? cycleDuration : 4;
	const hasElementDuration =
		typeof durationSeconds === "number" &&
		Number.isFinite(durationSeconds) &&
		durationSeconds > 0;
	const rawPhase = hasElementDuration
		? positiveModulo({
				value:
					(safeLocalTime *
						Math.max(1, Math.round(durationSeconds / safeCycleDuration))) /
					durationSeconds,
				divisor: 1,
			})
		: positiveModulo({
				value: safeLocalTime / safeCycleDuration,
				divisor: 1,
			});
	return direction === "reverse"
		? positiveModulo({ value: -rawPhase, divisor: 1 })
		: rawPhase;
}

function readNumber({
	value,
	fallback,
	min,
	max,
}: {
	value: unknown;
	fallback: number;
	min: number;
	max: number;
}): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.max(min, Math.min(max, value))
		: fallback;
}

function lerp({
	start,
	end,
	amount,
}: {
	start: number;
	end: number;
	amount: number;
}): number {
	return start + (end - start) * amount;
}

export function ratioValue({ value }: { value: unknown }): number {
	return value === "4:3"
		? 4 / 3
		: value === "3:4"
			? 3 / 4
			: value === "16:9"
				? 16 / 9
				: value === "4:5"
					? 4 / 5
					: value === "9:16"
						? 9 / 16
						: 1;
}

export function resolveTemplateFrameAppearance({
	templateVersion,
	params,
	canvasSize,
}: {
	templateVersion: number;
	params: Record<string, unknown>;
	canvasSize: { width: number; height: number };
}): { ratio: number; backgroundColor: string | null } {
	const canvasRatio =
		Number.isFinite(canvasSize.width) &&
		Number.isFinite(canvasSize.height) &&
		canvasSize.width > 0 &&
		canvasSize.height > 0
			? canvasSize.width / canvasSize.height
			: 1;
	const frameRatio = templateVersion < 2 ? "project" : params.frameRatio;
	return {
		ratio:
			frameRatio === "project"
				? canvasRatio
				: ratioValue({ value: frameRatio }),
		backgroundColor:
			params.backgroundEnabled === true && typeof params.background === "string"
				? params.background
				: null,
	};
}

export function templateFrameRatioForCanvas({
	width,
	height,
}: {
	width: number;
	height: number;
}): TemplateFrameRatio {
	if (
		!Number.isFinite(width) ||
		!Number.isFinite(height) ||
		width <= 0 ||
		height <= 0
	) {
		return "1:1";
	}
	const canvasRatio = width / height;
	return aspectRatios.reduce((closest, candidate) => {
		const closestDistance = Math.abs(
			Math.log(canvasRatio / ratioValue({ value: closest })),
		);
		const candidateDistance = Math.abs(
			Math.log(canvasRatio / ratioValue({ value: candidate })),
		);
		return candidateDistance < closestDistance ? candidate : closest;
	}, aspectRatios[0]);
}

export function projectedCardScaleX({
	rotationY,
}: {
	rotationY: number;
}): number {
	return Math.cos((rotationY * Math.PI) / 180);
}

export function projectedCardScaleY({
	rotationX,
}: {
	rotationX: number;
}): number {
	return Math.cos((rotationX * Math.PI) / 180);
}

export { resolveTemplateVideoSourceTimeSeconds } from "./media-timing";
export {
	normalizeMotionTemplateElementRecord,
	normalizeTemplateParams,
} from "./normalize";

function deterministicUnit({ index }: { index: number }): number {
	const value = Math.sin((index + 1) * 12.9898) * 43758.5453;
	return value - Math.floor(value);
}
