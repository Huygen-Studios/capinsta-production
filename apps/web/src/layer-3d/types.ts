export const LAYER_3D_PRESET_IDS = [
	"cinematic-push",
	"parallax-tilt",
	"floating-poster",
	"orbit-reveal",
	"light-sweep-hero",
] as const;

export type Layer3DPresetId = (typeof LAYER_3D_PRESET_IDS)[number];
export type Layer3DDirection = "forward" | "reverse" | "alternate";
export type Layer3DLightType = "directional" | "point";
export type Layer3DParameterValue = number | string | boolean;

export interface Quaternion {
	x: number;
	y: number;
	z: number;
	w: number;
}

export interface Layer3DTransform {
	positionX: number;
	positionY: number;
	positionZ: number;
	anchorX: number;
	anchorY: number;
	anchorZ: number;
	scaleX: number;
	scaleY: number;
	scaleZ: number;
	orientation: Quaternion;
	rotationX: number;
	rotationY: number;
	rotationZ: number;
}

export interface Layer3DCamera {
	perspective: number;
	focalLength: number;
	positionX: number;
	positionY: number;
	positionZ: number;
}

export interface Layer3DMaterial {
	acceptsLights: boolean;
	castsShadows: boolean;
	acceptsShadows: boolean;
	shadowDiffusion: number;
	ambient: number;
	diffuse: number;
	specularIntensity: number;
	specularShininess: number;
	metallic: number;
}

export interface Layer3DLight {
	enabled: boolean;
	type: Layer3DLightType;
	color: string;
	intensity: number;
	positionX: number;
	positionY: number;
	positionZ: number;
}

export interface Layer3DAnimation {
	duration: number;
	delay: number;
	easing: string;
	loop: boolean;
	direction: Layer3DDirection;
	intensity: number;
}

export interface Layer3DEffect {
	enabled: boolean;
	presetId: Layer3DPresetId;
	presetVersion: number;
	transform: Layer3DTransform;
	camera: Layer3DCamera;
	material: Layer3DMaterial;
	light: Layer3DLight;
	animation: Layer3DAnimation;
	parameterOverrides: Record<string, Layer3DParameterValue>;
}

export interface Layer3DParameterDefinition {
	id: string;
	label: string;
	min: number;
	max: number;
	step: number;
}

export interface Layer3DPresetDefinition {
	id: Layer3DPresetId;
	version: number;
	name: string;
	description: string;
	defaults: Layer3DEffect;
	parameters: Layer3DParameterDefinition[];
}

export interface Point2D {
	x: number;
	y: number;
}

export interface EvaluatedLayer3DMaterial {
	lightingEnabled: boolean;
	ambient: number;
	diffuse: number;
	specular: number;
	shininess: number;
	metallic: number;
	lightColor: string;
	lightIntensity: number;
	sweepPosition: number | null;
}

export interface EvaluatedLayer3DShadow {
	enabled: boolean;
	opacity: number;
	blur: number;
	offsetX: number;
	offsetY: number;
}

export interface EvaluatedLayer3D {
	modelMatrix: number[];
	projectedCorners: [Point2D, Point2D, Point2D, Point2D];
	opacity: number;
	depth: number;
	material: EvaluatedLayer3DMaterial;
	shadow: EvaluatedLayer3DShadow;
	normal: { x: number; y: number; z: number };
}
