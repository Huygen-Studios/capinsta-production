import type { Point2D, Quaternion } from "./types";

const EPSILON = 1e-8;
const DEG_TO_RAD = Math.PI / 180;

export function clampFinite({
	value,
	min,
	max,
	fallback,
}: {
	value: unknown;
	min: number;
	max: number;
	fallback: number;
}): number {
	return typeof value === "number" && Number.isFinite(value)
		? Math.min(max, Math.max(min, value))
		: fallback;
}

export function normalizeQuaternion({
	quaternion,
}: {
	quaternion: Quaternion;
}): Quaternion {
	const length = Math.hypot(
		quaternion.x,
		quaternion.y,
		quaternion.z,
		quaternion.w,
	);
	if (!Number.isFinite(length) || length < EPSILON) {
		return { x: 0, y: 0, z: 0, w: 1 };
	}
	return {
		x: quaternion.x / length,
		y: quaternion.y / length,
		z: quaternion.z / length,
		w: quaternion.w / length,
	};
}

export function multiplyQuaternions({
	left,
	right,
}: {
	left: Quaternion;
	right: Quaternion;
}): Quaternion {
	return normalizeQuaternion({
		quaternion: {
			w:
				left.w * right.w -
				left.x * right.x -
				left.y * right.y -
				left.z * right.z,
			x:
				left.w * right.x +
				left.x * right.w +
				left.y * right.z -
				left.z * right.y,
			y:
				left.w * right.y -
				left.x * right.z +
				left.y * right.w +
				left.z * right.x,
			z:
				left.w * right.z +
				left.x * right.y -
				left.y * right.x +
				left.z * right.w,
		},
	});
}

export function quaternionFromEuler({
	xDegrees,
	yDegrees,
	zDegrees,
}: {
	xDegrees: number;
	yDegrees: number;
	zDegrees: number;
}): Quaternion {
	const x = xDegrees * DEG_TO_RAD * 0.5;
	const y = yDegrees * DEG_TO_RAD * 0.5;
	const z = zDegrees * DEG_TO_RAD * 0.5;
	const cx = Math.cos(x);
	const sx = Math.sin(x);
	const cy = Math.cos(y);
	const sy = Math.sin(y);
	const cz = Math.cos(z);
	const sz = Math.sin(z);
	return normalizeQuaternion({
		quaternion: {
			w: cx * cy * cz + sx * sy * sz,
			x: sx * cy * cz - cx * sy * sz,
			y: cx * sy * cz + sx * cy * sz,
			z: cx * cy * sz - sx * sy * cz,
		},
	});
}

export function composeModelMatrix({
	position,
	anchor,
	scale,
	orientation,
}: {
	position: { x: number; y: number; z: number };
	anchor: { x: number; y: number; z: number };
	scale: { x: number; y: number; z: number };
	orientation: Quaternion;
}): number[] {
	const q = normalizeQuaternion({ quaternion: orientation });
	const xx = q.x * q.x;
	const yy = q.y * q.y;
	const zz = q.z * q.z;
	const xy = q.x * q.y;
	const xz = q.x * q.z;
	const yz = q.y * q.z;
	const wx = q.w * q.x;
	const wy = q.w * q.y;
	const wz = q.w * q.z;
	const r00 = 1 - 2 * (yy + zz);
	const r01 = 2 * (xy - wz);
	const r02 = 2 * (xz + wy);
	const r10 = 2 * (xy + wz);
	const r11 = 1 - 2 * (xx + zz);
	const r12 = 2 * (yz - wx);
	const r20 = 2 * (xz - wy);
	const r21 = 2 * (yz + wx);
	const r22 = 1 - 2 * (xx + yy);
	const tx =
		position.x -
		(r00 * anchor.x * scale.x +
			r01 * anchor.y * scale.y +
			r02 * anchor.z * scale.z);
	const ty =
		position.y -
		(r10 * anchor.x * scale.x +
			r11 * anchor.y * scale.y +
			r12 * anchor.z * scale.z);
	const tz =
		position.z -
		(r20 * anchor.x * scale.x +
			r21 * anchor.y * scale.y +
			r22 * anchor.z * scale.z);
	return [
		r00 * scale.x,
		r10 * scale.x,
		r20 * scale.x,
		0,
		r01 * scale.y,
		r11 * scale.y,
		r21 * scale.y,
		0,
		r02 * scale.z,
		r12 * scale.z,
		r22 * scale.z,
		0,
		tx,
		ty,
		tz,
		1,
	];
}

export function transformPoint3D({
	matrix,
	point,
}: {
	matrix: number[];
	point: { x: number; y: number; z: number };
}): { x: number; y: number; z: number } {
	return {
		x:
			matrix[0] * point.x +
			matrix[4] * point.y +
			matrix[8] * point.z +
			matrix[12],
		y:
			matrix[1] * point.x +
			matrix[5] * point.y +
			matrix[9] * point.z +
			matrix[13],
		z:
			matrix[2] * point.x +
			matrix[6] * point.y +
			matrix[10] * point.z +
			matrix[14],
	};
}

export function projectPoint({
	point,
	camera,
	frame,
}: {
	point: { x: number; y: number; z: number };
	camera: {
		perspective: number;
		focalLength: number;
		positionX: number;
		positionY: number;
		positionZ: number;
	};
	frame: { width: number; height: number };
}): Point2D {
	const relativeZ = point.z - camera.positionZ;
	const effectivePerspective = camera.perspective * (camera.focalLength / 50);
	const denominator = Math.max(1, effectivePerspective - relativeZ);
	const projection = effectivePerspective / denominator;
	return {
		x: frame.width / 2 + (point.x - camera.positionX) * projection,
		y: frame.height / 2 + (point.y - camera.positionY) * projection,
	};
}

export function transformDirection({
	matrix,
	direction,
}: {
	matrix: number[];
	direction: { x: number; y: number; z: number };
}): { x: number; y: number; z: number } {
	const x =
		matrix[0] * direction.x + matrix[4] * direction.y + matrix[8] * direction.z;
	const y =
		matrix[1] * direction.x + matrix[5] * direction.y + matrix[9] * direction.z;
	const z =
		matrix[2] * direction.x +
		matrix[6] * direction.y +
		matrix[10] * direction.z;
	const length = Math.max(EPSILON, Math.hypot(x, y, z));
	return { x: x / length, y: y / length, z: z / length };
}
