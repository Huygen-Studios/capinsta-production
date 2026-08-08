import { clampFinite, normalizeQuaternion } from "./math";
import { createLayer3DEffect, getLayer3DPreset } from "./presets";
import type {
	Layer3DDirection,
	Layer3DEffect,
	Layer3DLightType,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

function bool({
	value,
	fallback,
}: {
	value: unknown;
	fallback: boolean;
}): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function color({
	value,
	fallback,
}: {
	value: unknown;
	fallback: string;
}): string {
	return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
		? value.toUpperCase()
		: fallback;
}

function direction({
	value,
	fallback,
}: {
	value: unknown;
	fallback: Layer3DDirection;
}): Layer3DDirection {
	return value === "forward" || value === "reverse" || value === "alternate"
		? value
		: fallback;
}

function lightType({
	value,
	fallback,
}: {
	value: unknown;
	fallback: Layer3DLightType;
}): Layer3DLightType {
	return value === "directional" || value === "point" ? value : fallback;
}

export function normalizeLayer3DEffect({
	value,
}: {
	value: unknown;
}): Layer3DEffect | null {
	const source = record(value);
	const preset =
		typeof source.presetId === "string"
			? getLayer3DPreset({ presetId: source.presetId })
			: null;
	if (!preset) return null;
	const fallback = createLayer3DEffect({ presetId: preset.id });
	const transform = record(source.transform);
	const orientation = record(transform.orientation);
	const camera = record(source.camera);
	const material = record(source.material);
	const light = record(source.light);
	const animation = record(source.animation);
	const parameters = record(source.parameterOverrides);
	const parameterOverrides = { ...fallback.parameterOverrides };
	for (const parameter of preset.parameters) {
		const fallbackValue = fallback.parameterOverrides[parameter.id];
		parameterOverrides[parameter.id] = clampFinite({
			value: parameters[parameter.id],
			min: parameter.min,
			max: parameter.max,
			fallback:
				typeof fallbackValue === "number" ? fallbackValue : parameter.min,
		});
	}
	if (preset.id === "orbit-reveal") {
		parameterOverrides.orbitDirection =
			parameters.orbitDirection === "right" ? "right" : "left";
	}
	if (preset.id === "light-sweep-hero") {
		parameterOverrides.sweepDirection =
			parameters.sweepDirection === "left" ? "left" : "right";
	}
	return {
		enabled: bool({ value: source.enabled, fallback: fallback.enabled }),
		presetId: preset.id,
		presetVersion: preset.version,
		transform: {
			positionX: clampFinite({
				value: transform.positionX,
				min: -10_000,
				max: 10_000,
				fallback: fallback.transform.positionX,
			}),
			positionY: clampFinite({
				value: transform.positionY,
				min: -10_000,
				max: 10_000,
				fallback: fallback.transform.positionY,
			}),
			positionZ: clampFinite({
				value: transform.positionZ,
				min: -2_000,
				max: 2_000,
				fallback: fallback.transform.positionZ,
			}),
			anchorX: clampFinite({
				value: transform.anchorX,
				min: -5_000,
				max: 5_000,
				fallback: fallback.transform.anchorX,
			}),
			anchorY: clampFinite({
				value: transform.anchorY,
				min: -5_000,
				max: 5_000,
				fallback: fallback.transform.anchorY,
			}),
			anchorZ: clampFinite({
				value: transform.anchorZ,
				min: -2_000,
				max: 2_000,
				fallback: fallback.transform.anchorZ,
			}),
			scaleX: clampFinite({
				value: transform.scaleX,
				min: 1,
				max: 500,
				fallback: fallback.transform.scaleX,
			}),
			scaleY: clampFinite({
				value: transform.scaleY,
				min: 1,
				max: 500,
				fallback: fallback.transform.scaleY,
			}),
			scaleZ: clampFinite({
				value: transform.scaleZ,
				min: 1,
				max: 500,
				fallback: fallback.transform.scaleZ,
			}),
			orientation: normalizeQuaternion({
				quaternion: {
					x: clampFinite({
						value: orientation.x,
						min: -1,
						max: 1,
						fallback: 0,
					}),
					y: clampFinite({
						value: orientation.y,
						min: -1,
						max: 1,
						fallback: 0,
					}),
					z: clampFinite({
						value: orientation.z,
						min: -1,
						max: 1,
						fallback: 0,
					}),
					w: clampFinite({
						value: orientation.w,
						min: -1,
						max: 1,
						fallback: 1,
					}),
				},
			}),
			rotationX: clampFinite({
				value: transform.rotationX,
				min: -3600,
				max: 3600,
				fallback: 0,
			}),
			rotationY: clampFinite({
				value: transform.rotationY,
				min: -3600,
				max: 3600,
				fallback: 0,
			}),
			rotationZ: clampFinite({
				value: transform.rotationZ,
				min: -3600,
				max: 3600,
				fallback: 0,
			}),
		},
		camera: {
			perspective: clampFinite({
				value: camera.perspective,
				min: 100,
				max: 5000,
				fallback: fallback.camera.perspective,
			}),
			focalLength: clampFinite({
				value: camera.focalLength,
				min: 10,
				max: 300,
				fallback: fallback.camera.focalLength,
			}),
			positionX: clampFinite({
				value: camera.positionX,
				min: -5000,
				max: 5000,
				fallback: 0,
			}),
			positionY: clampFinite({
				value: camera.positionY,
				min: -5000,
				max: 5000,
				fallback: 0,
			}),
			positionZ: clampFinite({
				value: camera.positionZ,
				min: -5000,
				max: 5000,
				fallback: fallback.camera.positionZ,
			}),
		},
		material: {
			acceptsLights: bool({
				value: material.acceptsLights,
				fallback: fallback.material.acceptsLights,
			}),
			castsShadows: bool({
				value: material.castsShadows,
				fallback: fallback.material.castsShadows,
			}),
			acceptsShadows: bool({
				value: material.acceptsShadows,
				fallback: fallback.material.acceptsShadows,
			}),
			shadowDiffusion: clampFinite({
				value: material.shadowDiffusion,
				min: 0,
				max: 100,
				fallback: fallback.material.shadowDiffusion,
			}),
			ambient: clampFinite({
				value: material.ambient,
				min: 0,
				max: 100,
				fallback: fallback.material.ambient,
			}),
			diffuse: clampFinite({
				value: material.diffuse,
				min: 0,
				max: 100,
				fallback: fallback.material.diffuse,
			}),
			specularIntensity: clampFinite({
				value: material.specularIntensity,
				min: 0,
				max: 100,
				fallback: fallback.material.specularIntensity,
			}),
			specularShininess: clampFinite({
				value: material.specularShininess,
				min: 1,
				max: 200,
				fallback: fallback.material.specularShininess,
			}),
			metallic: clampFinite({
				value: material.metallic,
				min: 0,
				max: 100,
				fallback: fallback.material.metallic,
			}),
		},
		light: {
			enabled: bool({ value: light.enabled, fallback: fallback.light.enabled }),
			type: lightType({ value: light.type, fallback: fallback.light.type }),
			color: color({ value: light.color, fallback: fallback.light.color }),
			intensity: clampFinite({
				value: light.intensity,
				min: 0,
				max: 100,
				fallback: fallback.light.intensity,
			}),
			positionX: clampFinite({
				value: light.positionX,
				min: -5000,
				max: 5000,
				fallback: fallback.light.positionX,
			}),
			positionY: clampFinite({
				value: light.positionY,
				min: -5000,
				max: 5000,
				fallback: fallback.light.positionY,
			}),
			positionZ: clampFinite({
				value: light.positionZ,
				min: -5000,
				max: 5000,
				fallback: fallback.light.positionZ,
			}),
		},
		animation: {
			duration: clampFinite({
				value: animation.duration,
				min: 0.05,
				max: 120,
				fallback: fallback.animation.duration,
			}),
			delay: clampFinite({
				value: animation.delay,
				min: 0,
				max: 120,
				fallback: fallback.animation.delay,
			}),
			easing:
				typeof animation.easing === "string"
					? animation.easing
					: fallback.animation.easing,
			loop: bool({ value: animation.loop, fallback: fallback.animation.loop }),
			direction: direction({
				value: animation.direction,
				fallback: fallback.animation.direction,
			}),
			intensity: clampFinite({
				value: animation.intensity,
				min: 0,
				max: 200,
				fallback: fallback.animation.intensity,
			}),
		},
		parameterOverrides,
	};
}
