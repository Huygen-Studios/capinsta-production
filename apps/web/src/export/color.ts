import type { TBackground } from "@/project/types";
import type { ExportMode } from "./index";

export const DEFAULT_SOLID_EXPORT_BACKGROUND = "#00FF00";

const HEX_RGB = /^#?[0-9A-Fa-f]{6}$/;
const HEX_RGB_SHORT = /^#?[0-9A-Fa-f]{3}$/;

export function normalizeExportHexColor({
	value,
}: {
	value: string | null | undefined;
}): string | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (!HEX_RGB.test(trimmed) && !HEX_RGB_SHORT.test(trimmed)) return null;
	let digits = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
	if (digits.length === 3) {
		digits = `${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`;
	}
	return `#${digits.toUpperCase()}`;
}

export function resolveSolidExportBackground({
	value,
	fallback = DEFAULT_SOLID_EXPORT_BACKGROUND,
}: {
	value: string | null | undefined;
	fallback?: string;
}): string {
	return (
		normalizeExportHexColor({ value }) ??
		normalizeExportHexColor({ value: fallback }) ??
		DEFAULT_SOLID_EXPORT_BACKGROUND
	);
}

export function resolveExportSceneBackground({
	exportMode,
	requestedColor,
	projectBackground,
}: {
	exportMode: ExportMode;
	requestedColor: string | null | undefined;
	projectBackground: TBackground;
}): TBackground {
	return exportMode === "captions_solid_background"
		? {
				type: "color",
				color: resolveSolidExportBackground({ value: requestedColor }),
			}
		: projectBackground;
}
