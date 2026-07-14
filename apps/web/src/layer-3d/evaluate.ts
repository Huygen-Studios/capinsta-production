import {
	composeModelMatrix,
	multiplyQuaternions,
	projectPoint,
	quaternionFromEuler,
	transformDirection,
	transformPoint3D,
} from "./math";
import { normalizeLayer3DEffect } from "./normalize";
import type { EvaluatedLayer3D, Layer3DEffect, Point2D } from "./types";

const TAU = Math.PI * 2;

function numberParam({
	effect,
	key,
	fallback,
}: {
	effect: Layer3DEffect;
	key: string;
	fallback: number;
}): number {
	const value = effect.parameterOverrides[key];
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function ease({ value, easing }: { value: number; easing: string }): number {
	const t = Math.min(1, Math.max(0, value));
	switch (easing) {
		case "linear":
			return t;
		case "snappy":
			return 1 - Math.pow(1 - t, 4);
		case "overshoot": {
			const c = 1.4;
			return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
		}
		default:
			return t * t * (3 - 2 * t);
	}
}

function progressAtTime({
	effect,
	localTimeSeconds,
}: {
	effect: Layer3DEffect;
	localTimeSeconds: number;
}): number {
	const elapsed = Math.max(0, localTimeSeconds - effect.animation.delay);
	const raw = effect.animation.loop
		? (((elapsed % effect.animation.duration) + effect.animation.duration) %
				effect.animation.duration) /
			effect.animation.duration
		: Math.min(1, elapsed / effect.animation.duration);
	if (effect.animation.direction === "reverse") return 1 - raw;
	if (effect.animation.direction === "alternate") {
		const cycle = Math.floor(elapsed / effect.animation.duration);
		return cycle % 2 === 0 ? raw : 1 - raw;
	}
	return raw;
}

function animatedValues({
	effect,
	progress,
}: {
	effect: Layer3DEffect;
	progress: number;
}) {
	const t = ease({ value: progress, easing: effect.animation.easing });
	const intensity = effect.animation.intensity / 100;
	switch (effect.presetId) {
		case "cinematic-push":
			return {
				x: 0,
				y: 0,
				z:
					-numberParam({ effect, key: "pushDistance", fallback: 180 }) *
					(1 - t) *
					intensity,
				rx:
					numberParam({ effect, key: "startRotationX", fallback: 6 }) *
					(1 - t) *
					intensity,
				ry:
					numberParam({ effect, key: "startRotationY", fallback: -9 }) *
					(1 - t) *
					intensity,
				rz: 0,
				scale:
					1 +
					(numberParam({ effect, key: "finalScale", fallback: 106 }) / 100 -
						1) *
						t,
				sweep: null,
			};
		case "parallax-tilt":
			return {
				x:
					numberParam({ effect, key: "driftX", fallback: 45 }) *
					(t - 0.5) *
					intensity,
				y:
					numberParam({ effect, key: "driftY", fallback: -20 }) *
					(t - 0.5) *
					intensity,
				z:
					numberParam({ effect, key: "depthAmount", fallback: 55 }) *
					Math.sin(Math.PI * t) *
					intensity,
				rx:
					numberParam({ effect, key: "tiltX", fallback: 9 }) *
					Math.sin(Math.PI * (t - 0.5)) *
					intensity,
				ry:
					numberParam({ effect, key: "tiltY", fallback: -13 }) *
					Math.sin(Math.PI * (t - 0.5)) *
					intensity,
				rz: 0,
				scale: numberParam({ effect, key: "scale", fallback: 104 }) / 100,
				sweep: null,
			};
		case "floating-poster": {
			const phase =
				progress *
				TAU *
				numberParam({ effect, key: "floatSpeed", fallback: 1 });
			return {
				x: 0,
				y:
					Math.sin(phase) *
					numberParam({ effect, key: "verticalMovement", fallback: 24 }) *
					intensity,
				z:
					Math.cos(phase) *
					numberParam({ effect, key: "floatDistance", fallback: 55 }) *
					intensity,
				rx: 0,
				ry:
					Math.sin(phase) *
					numberParam({ effect, key: "rotationAmount", fallback: 4 }) *
					intensity,
				rz:
					Math.cos(phase) *
					numberParam({ effect, key: "rotationAmount", fallback: 4 }) *
					0.6 *
					intensity,
				scale: 1,
				sweep: null,
			};
		}
		case "orbit-reveal": {
			const distance =
				numberParam({ effect, key: "orbitDistance", fallback: 260 }) *
				intensity;
			const direction =
				effect.parameterOverrides.orbitDirection === "right" ? -1 : 1;
			return {
				x: -direction * distance * (1 - t),
				y: -Math.sin(Math.PI * t) * distance * 0.16,
				z: -distance * 0.55 * (1 - t),
				rx:
					numberParam({ effect, key: "startXRotation", fallback: 12 }) *
					(1 - t),
				ry:
					numberParam({ effect, key: "startYRotation", fallback: -58 }) *
					direction *
					(1 - t),
				rz: 0,
				scale:
					1 +
					(Math.sin(Math.PI * t) *
						numberParam({ effect, key: "overshoot", fallback: 8 })) /
						100,
				sweep: null,
			};
		}
		case "light-sweep-hero": {
			const direction =
				effect.parameterOverrides.sweepDirection === "left" ? 1 : -1;
			return {
				x: 0,
				y: 0,
				z:
					-numberParam({ effect, key: "movementAmount", fallback: 45 }) *
					(1 - t) *
					intensity,
				rx: 0,
				ry: direction * 7 * (1 - t) * intensity,
				rz: 0,
				scale: 1.02,
				sweep: direction > 0 ? 1 - t : t,
			};
		}
	}
}

export function evaluateLayer3DEffect({
	effect: rawEffect,
	localTimeSeconds,
	frame,
	layer,
}: {
	effect: Layer3DEffect;
	localTimeSeconds: number;
	frame: { width: number; height: number };
	layer: { width: number; height: number };
}): EvaluatedLayer3D | null {
	const effect = normalizeLayer3DEffect({ value: rawEffect });
	if (!effect?.enabled) return null;
	const progress = progressAtTime({ effect, localTimeSeconds });
	const animated = animatedValues({ effect, progress });
	const euler = quaternionFromEuler({
		xDegrees: effect.transform.rotationX + animated.rx,
		yDegrees: effect.transform.rotationY + animated.ry,
		zDegrees: effect.transform.rotationZ + animated.rz,
	});
	const orientation = multiplyQuaternions({
		left: effect.transform.orientation,
		right: euler,
	});
	const modelMatrix = composeModelMatrix({
		position: {
			x: effect.transform.positionX + animated.x,
			y: effect.transform.positionY + animated.y,
			z: effect.transform.positionZ + animated.z,
		},
		anchor: {
			x: effect.transform.anchorX,
			y: effect.transform.anchorY,
			z: effect.transform.anchorZ,
		},
		scale: {
			x: (effect.transform.scaleX / 100) * animated.scale,
			y: (effect.transform.scaleY / 100) * animated.scale,
			z: effect.transform.scaleZ / 100,
		},
		orientation,
	});
	const localCorners = [
		{ x: -layer.width / 2, y: -layer.height / 2, z: 0 },
		{ x: layer.width / 2, y: -layer.height / 2, z: 0 },
		{ x: layer.width / 2, y: layer.height / 2, z: 0 },
		{ x: -layer.width / 2, y: layer.height / 2, z: 0 },
	] as const;
	const projectCorner = ({ point }: { point: (typeof localCorners)[number] }) =>
		projectPoint({
			point: transformPoint3D({ matrix: modelMatrix, point }),
			camera: effect.camera,
			frame,
		});
	const projectedCorners: [Point2D, Point2D, Point2D, Point2D] = [
		projectCorner({ point: localCorners[0] }),
		projectCorner({ point: localCorners[1] }),
		projectCorner({ point: localCorners[2] }),
		projectCorner({ point: localCorners[3] }),
	];
	const normal = transformDirection({
		matrix: modelMatrix,
		direction: { x: 0, y: 0, z: 1 },
	});
	const lightEnabled = effect.light.enabled && effect.material.acceptsLights;
	const lightLength = Math.max(
		1e-8,
		Math.hypot(
			effect.light.positionX,
			effect.light.positionY,
			effect.light.positionZ,
		),
	);
	const lightDirection =
		effect.light.type === "point"
			? {
					x: (effect.light.positionX - modelMatrix[12]) / lightLength,
					y: (effect.light.positionY - modelMatrix[13]) / lightLength,
					z: (effect.light.positionZ - modelMatrix[14]) / lightLength,
				}
			: {
					x: -effect.light.positionX / lightLength,
					y: -effect.light.positionY / lightLength,
					z: effect.light.positionZ / lightLength,
				};
	const normalDotLight = Math.max(
		0,
		normal.x * lightDirection.x +
			normal.y * lightDirection.y +
			normal.z * lightDirection.z,
	);
	const configuredLightIntensity =
		numberParam({
			effect,
			key: "lightIntensity",
			fallback: effect.light.intensity,
		}) / 100;
	const configuredSpecular =
		numberParam({
			effect,
			key: "specularIntensity",
			fallback: effect.material.specularIntensity,
		}) / 100;
	const configuredShininess = numberParam({
		effect,
		key: "specularShininess",
		fallback: effect.material.specularShininess,
	});
	const configuredMetallic =
		numberParam({
			effect,
			key: "metallic",
			fallback: effect.material.metallic,
		}) / 100;
	const diffuse = lightEnabled
		? (normalDotLight * effect.material.diffuse) / 100
		: 0;
	const specular = lightEnabled
		? Math.pow(normalDotLight, Math.max(1, configuredShininess / 12)) *
			configuredSpecular
		: 0;
	const depth = modelMatrix[14];
	const castsShadow = effect.material.castsShadows;
	return {
		modelMatrix,
		projectedCorners,
		opacity: 1,
		depth,
		normal,
		material: {
			lightingEnabled: lightEnabled,
			ambient: effect.material.ambient / 100,
			diffuse,
			specular,
			shininess: configuredShininess,
			metallic: configuredMetallic,
			lightColor: effect.light.color,
			lightIntensity: lightEnabled ? configuredLightIntensity : 0,
			sweepPosition: animated.sweep,
		},
		shadow: {
			enabled: castsShadow,
			opacity: castsShadow
				? Math.min(
						0.8,
						(numberParam({ effect, key: "shadowIntensity", fallback: 35 }) /
							100) *
							(0.55 + Math.abs(depth) / 1600),
					)
				: 0,
			blur: castsShadow
				? numberParam({
						effect,
						key: "shadowSoftness",
						fallback: effect.material.shadowDiffusion,
					}) *
					(1 + Math.abs(depth) / 1000)
				: 0,
			offsetX: castsShadow ? -effect.light.positionX / 35 : 0,
			offsetY: castsShadow
				? -effect.light.positionY / 35 + Math.abs(depth) / 30
				: 0,
		},
	};
}
