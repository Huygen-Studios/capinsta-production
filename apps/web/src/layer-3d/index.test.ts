import { describe, expect, test } from "bun:test";
import {
	LAYER_3D_PRESETS,
	composeModelMatrix,
	createLayer3DEffect,
	evaluateLayer3DEffect,
	normalizeLayer3DEffect,
	normalizeQuaternion,
	projectPoint,
} from "./index";

describe("3D motion effects", () => {
	test("registers exactly five valid unique presets", () => {
		expect(LAYER_3D_PRESETS).toHaveLength(5);
		expect(new Set(LAYER_3D_PRESETS.map((preset) => preset.id)).size).toBe(5);
		for (const preset of LAYER_3D_PRESETS) {
			expect(preset.version).toBeGreaterThan(0);
			expect(preset.defaults.presetVersion).toBe(preset.version);
			expect(normalizeLayer3DEffect({ value: preset.defaults })).not.toBeNull();
			expect(
				new Set(preset.parameters.map((parameter) => parameter.id)).size,
			).toBe(preset.parameters.length);
			for (const parameter of preset.parameters) {
				expect(Number.isFinite(parameter.min)).toBe(true);
				expect(Number.isFinite(parameter.max)).toBe(true);
				expect(parameter.min).toBeLessThan(parameter.max);
				const defaultValue = preset.defaults.parameterOverrides[parameter.id];
				expect(typeof defaultValue).toBe("number");
				if (typeof defaultValue === "number") {
					expect(defaultValue).toBeGreaterThanOrEqual(parameter.min);
					expect(defaultValue).toBeLessThanOrEqual(parameter.max);
				}
			}
		}
	});

	test("normalizes zero and malformed quaternions", () => {
		expect(
			normalizeQuaternion({ quaternion: { x: 0, y: 0, z: 0, w: 0 } }),
		).toEqual({ x: 0, y: 0, z: 0, w: 1 });
		const normalized = normalizeQuaternion({
			quaternion: { x: 1, y: 2, z: 3, w: 4 },
		});
		expect(
			Math.hypot(normalized.x, normalized.y, normalized.z, normalized.w),
		).toBeCloseTo(1, 8);
	});

	test("composes anchor-aware finite matrices and perspective", () => {
		const matrix = composeModelMatrix({
			position: { x: 10, y: 20, z: 30 },
			anchor: { x: 5, y: 6, z: 7 },
			scale: { x: 1, y: 1, z: 1 },
			orientation: { x: 0, y: 0, z: 0, w: 1 },
		});
		expect(matrix).toHaveLength(16);
		expect(matrix.every(Number.isFinite)).toBe(true);
		const projected = projectPoint({
			point: { x: 10, y: 20, z: 30 },
			camera: {
				perspective: 900,
				focalLength: 50,
				positionX: 0,
				positionY: 0,
				positionZ: -50,
			},
			frame: { width: 1920, height: 1080 },
		});
		expect(Number.isFinite(projected.x)).toBe(true);
		expect(Number.isFinite(projected.y)).toBe(true);
	});

	test("all presets produce finite distinct deterministic motion", () => {
		const signatures = new Set<string>();
		for (const preset of LAYER_3D_PRESETS) {
			const effect = createLayer3DEffect({ presetId: preset.id });
			const samples = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
				const first = evaluateLayer3DEffect({
					effect,
					localTimeSeconds: effect.animation.duration * fraction,
					frame: { width: 1920, height: 1080 },
					layer: { width: 960, height: 540 },
				});
				const second = evaluateLayer3DEffect({
					effect,
					localTimeSeconds: effect.animation.duration * fraction,
					frame: { width: 1920, height: 1080 },
					layer: { width: 960, height: 540 },
				});
				expect(first).toEqual(second);
				expect(first?.modelMatrix.every(Number.isFinite)).toBe(true);
				expect(
					first?.projectedCorners
						.flatMap((point) => [point.x, point.y])
						.every(Number.isFinite),
				).toBe(true);
				return first?.modelMatrix.map((value) => value.toFixed(3)).join(":");
			});
			signatures.add(samples.join("|"));
		}
		expect(signatures.size).toBe(5);
	});

	test("Floating Poster closes its loop", () => {
		const effect = createLayer3DEffect({ presetId: "floating-poster" });
		const start = evaluateLayer3DEffect({
			effect,
			localTimeSeconds: 0,
			frame: { width: 1280, height: 720 },
			layer: { width: 640, height: 360 },
		});
		const end = evaluateLayer3DEffect({
			effect,
			localTimeSeconds: effect.animation.duration,
			frame: { width: 1280, height: 720 },
			layer: { width: 640, height: 360 },
		});
		expect(end?.modelMatrix).toEqual(start?.modelMatrix);
		expect(end?.projectedCorners).toEqual(start?.projectedCorners);
	});

	test("disabling lights skips diffuse and specular work", () => {
		const effect = createLayer3DEffect({ presetId: "light-sweep-hero" });
		effect.material.acceptsLights = false;
		const evaluated = evaluateLayer3DEffect({
			effect,
			localTimeSeconds: 1,
			frame: { width: 1280, height: 720 },
			layer: { width: 640, height: 360 },
		});
		expect(evaluated?.material.lightingEnabled).toBe(false);
		expect(evaluated?.material.diffuse).toBe(0);
		expect(evaluated?.material.specular).toBe(0);
	});

	test("camera, light, material and shadow controls affect evaluated output", () => {
		const effect = createLayer3DEffect({ presetId: "light-sweep-hero" });
		const evaluate = () =>
			evaluateLayer3DEffect({
				effect,
				localTimeSeconds: 1,
				frame: { width: 1280, height: 720 },
				layer: { width: 640, height: 360 },
			});
		const baseline = evaluate();
		effect.camera.focalLength = 110;
		effect.light.type = "point";
		effect.light.color = "#22AAFF";
		effect.light.intensity = 82;
		effect.material.metallic = 72;
		effect.material.shadowDiffusion = 80;
		const customized = evaluate();
		expect(customized?.projectedCorners).not.toEqual(
			baseline?.projectedCorners,
		);
		expect(customized?.material.lightColor).toBe("#22AAFF");
		expect(customized?.material.lightIntensity).toBeCloseTo(0.82, 5);
		expect(customized?.material.metallic).toBeCloseTo(0.72, 5);
		expect(customized?.shadow.blur).toBeGreaterThan(baseline?.shadow.blur ?? 0);
		effect.material.castsShadows = false;
		expect(evaluate()?.shadow).toEqual({
			enabled: false,
			opacity: 0,
			blur: 0,
			offsetX: 0,
			offsetY: 0,
		});
	});

	test("normalizes malformed persisted values and unknown presets safely", () => {
		const effect = createLayer3DEffect({ presetId: "cinematic-push" });
		const malformed = {
			...effect,
			parameterOverrides: { pushDistance: 50_000 },
			transform: {
				...effect.transform,
				positionZ: Number.POSITIVE_INFINITY,
				scaleZ: -10,
				orientation: { x: 0, y: 0, z: 0, w: 0 },
			},
			light: { ...effect.light, color: "url(bad)" },
		};
		const normalized = normalizeLayer3DEffect({ value: malformed });
		expect(normalized?.transform.positionZ).toBe(0);
		expect(normalized?.transform.scaleZ).toBe(1);
		expect(normalized?.transform.orientation).toEqual({
			x: 0,
			y: 0,
			z: 0,
			w: 1,
		});
		expect(normalized?.light.color).toBe("#FFFFFF");
		expect(normalized?.parameterOverrides.pushDistance).toBe(500);
		expect(
			normalizeLayer3DEffect({ value: { presetId: "unknown" } }),
		).toBeNull();
	});
});
