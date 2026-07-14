export const MAX_EXPORT_LONG_EDGE = 1920;
export const MAX_EXPORT_PIXEL_COUNT = 2_073_600;
export const MAX_EXPORT_FPS = 60;

export function validateExportOutput({
	width,
	height,
	fps,
}: {
	width: number;
	height: number;
	fps: number;
}): string | null {
	if (![width, height, fps].every(Number.isFinite)) {
		return "Export dimensions and frame rate must be finite numbers.";
	}
	if (width <= 0 || height <= 0) {
		return "Export dimensions must be positive.";
	}
	if (Math.max(width, height) > MAX_EXPORT_LONG_EDGE) {
		return `Export dimensions exceed the ${MAX_EXPORT_LONG_EDGE}px edge limit.`;
	}
	if (width * height > MAX_EXPORT_PIXEL_COUNT) {
		return `Export dimensions exceed the ${MAX_EXPORT_PIXEL_COUNT} pixel limit.`;
	}
	if (fps <= 0 || fps > MAX_EXPORT_FPS) {
		return `Export frame rate must be between 1 and ${MAX_EXPORT_FPS} FPS.`;
	}
	return null;
}
