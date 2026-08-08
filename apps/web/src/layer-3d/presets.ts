import type {
	Layer3DEffect,
	Layer3DPresetDefinition,
	Layer3DPresetId,
} from "./types";

function baseEffect({
	presetId,
}: {
	presetId: Layer3DPresetId;
}): Layer3DEffect {
	return {
		enabled: true,
		presetId,
		presetVersion: 1,
		transform: {
			positionX: 0,
			positionY: 0,
			positionZ: 0,
			anchorX: 0,
			anchorY: 0,
			anchorZ: 0,
			scaleX: 100,
			scaleY: 100,
			scaleZ: 100,
			orientation: { x: 0, y: 0, z: 0, w: 1 },
			rotationX: 0,
			rotationY: 0,
			rotationZ: 0,
		},
		camera: {
			perspective: 900,
			focalLength: 50,
			positionX: 0,
			positionY: 0,
			positionZ: -50,
		},
		material: {
			acceptsLights: true,
			castsShadows: true,
			acceptsShadows: false,
			shadowDiffusion: 35,
			ambient: 75,
			diffuse: 35,
			specularIntensity: 20,
			specularShininess: 48,
			metallic: 5,
		},
		light: {
			enabled: true,
			type: "directional",
			color: "#FFFFFF",
			intensity: 55,
			positionX: -300,
			positionY: -250,
			positionZ: 500,
		},
		animation: {
			duration: 3,
			delay: 0,
			easing: "smooth",
			loop: false,
			direction: "forward",
			intensity: 100,
		},
		parameterOverrides: {},
	};
}

function preset({
	id,
	name,
	description,
	params,
	overrides,
}: {
	id: Layer3DPresetId;
	name: string;
	description: string;
	params: Layer3DPresetDefinition["parameters"];
	overrides: Record<string, number | string | boolean>;
}): Layer3DPresetDefinition {
	const defaults = baseEffect({ presetId: id });
	defaults.parameterOverrides = { ...overrides };
	if (id === "floating-poster") defaults.animation.loop = true;
	if (id === "light-sweep-hero") {
		defaults.material.specularIntensity = 65;
		defaults.material.specularShininess = 90;
		defaults.material.metallic = 35;
	}
	return { id, version: 1, name, description, defaults, parameters: params };
}

const range = ({
	id,
	label,
	min,
	max,
	step = 1,
}: {
	id: string;
	label: string;
	min: number;
	max: number;
	step?: number;
}) => ({ id, label, min, max, step });

export const LAYER_3D_PRESETS = [
	preset({
		id: "cinematic-push",
		name: "Cinematic Push",
		description: "A smooth camera-like push with subtle perspective rotation.",
		overrides: {
			pushDistance: 180,
			startRotationX: 6,
			startRotationY: -9,
			finalScale: 106,
			shadowIntensity: 35,
		},
		params: [
			range({ id: "pushDistance", label: "Push distance", min: 0, max: 500 }),
			range({
				id: "startRotationX",
				label: "Start rotation X",
				min: -45,
				max: 45,
			}),
			range({
				id: "startRotationY",
				label: "Start rotation Y",
				min: -45,
				max: 45,
			}),
			range({ id: "finalScale", label: "Final scale", min: 80, max: 140 }),
			range({
				id: "shadowIntensity",
				label: "Shadow intensity",
				min: 0,
				max: 100,
			}),
		],
	}),
	preset({
		id: "parallax-tilt",
		name: "Parallax Tilt",
		description: "A restrained 3D card tilt with depth and lateral drift.",
		overrides: {
			tiltX: 9,
			tiltY: -13,
			depthAmount: 55,
			driftX: 45,
			driftY: -20,
			scale: 104,
		},
		params: [
			range({ id: "tiltX", label: "Tilt X", min: -35, max: 35 }),
			range({ id: "tiltY", label: "Tilt Y", min: -35, max: 35 }),
			range({ id: "depthAmount", label: "Depth amount", min: 0, max: 250 }),
			range({ id: "driftX", label: "Drift X", min: -300, max: 300 }),
			range({ id: "driftY", label: "Drift Y", min: -300, max: 300 }),
			range({ id: "scale", label: "Scale", min: 70, max: 140 }),
		],
	}),
	preset({
		id: "floating-poster",
		name: "Floating Poster",
		description:
			"A seamless floating loop with soft rotation, lighting and shadow.",
		overrides: {
			floatDistance: 55,
			floatSpeed: 1,
			rotationAmount: 4,
			verticalMovement: 24,
			shadowSoftness: 55,
		},
		params: [
			range({ id: "floatDistance", label: "Float distance", min: 0, max: 200 }),
			range({
				id: "floatSpeed",
				label: "Float speed",
				min: 0.25,
				max: 4,
				step: 0.05,
			}),
			range({
				id: "rotationAmount",
				label: "Rotation amount",
				min: 0,
				max: 20,
				step: 0.1,
			}),
			range({
				id: "verticalMovement",
				label: "Vertical movement",
				min: 0,
				max: 150,
			}),
			range({
				id: "shadowSoftness",
				label: "Shadow softness",
				min: 0,
				max: 100,
			}),
		],
	}),
	preset({
		id: "orbit-reveal",
		name: "Orbit Reveal",
		description:
			"An angled orbit-like entrance that settles facing the camera.",
		overrides: {
			orbitDirection: "left",
			orbitDistance: 260,
			startYRotation: -58,
			startXRotation: 12,
			overshoot: 8,
		},
		params: [
			range({ id: "orbitDistance", label: "Orbit distance", min: 0, max: 600 }),
			range({
				id: "startYRotation",
				label: "Start Y rotation",
				min: -120,
				max: 120,
			}),
			range({
				id: "startXRotation",
				label: "Start X rotation",
				min: -60,
				max: 60,
			}),
			range({ id: "overshoot", label: "Overshoot", min: 0, max: 30 }),
		],
	}),
	preset({
		id: "light-sweep-hero",
		name: "Light Sweep Hero",
		description:
			"A premium product-shot move with a renderer-driven specular sweep.",
		overrides: {
			sweepDirection: "right",
			movementAmount: 45,
		},
		params: [
			range({
				id: "movementAmount",
				label: "Movement amount",
				min: 0,
				max: 180,
			}),
		],
	}),
] as const satisfies readonly Layer3DPresetDefinition[];

export function getLayer3DPreset({
	presetId,
}: {
	presetId: string;
}): Layer3DPresetDefinition | null {
	return (
		LAYER_3D_PRESETS.find((definition) => definition.id === presetId) ?? null
	);
}

export function createLayer3DEffect({
	presetId,
}: {
	presetId: Layer3DPresetId;
}): Layer3DEffect {
	const definition = getLayer3DPreset({ presetId });
	if (!definition) throw new Error(`Unknown 3D motion preset: ${presetId}`);
	return structuredClone(definition.defaults);
}
