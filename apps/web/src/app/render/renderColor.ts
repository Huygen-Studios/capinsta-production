/**
 * Canonical background-color handling for the headless render route.
 *
 * This is the single source of truth for resolving the captions-only export
 * background color. It is shared by the export modal defaults, the render
 * client, and the readiness validation so that every layer agrees on the
 * canonical property name (`backgroundColor`) and the canonical fallback.
 *
 * Design rules (see export bug fix spec):
 *  - A valid user-selected hex color is NEVER replaced with a white fallback.
 *  - Valid colors are normalized to `#RRGGBB` (uppercase) so the same string
 *    flows from export UI -> backend -> headless injection -> composition root.
 *  - `#00FF00` is the ONLY captions-only default, used solely when no color
 *    (or an empty/transparent color) was provided.
 *  - White (`#FFFFFF`) is a legitimate explicit selection and must pass through.
 *  - `transparent`/empty in captions-only mode resolves to the green default,
 *    never to white.
 *  - In full-video mode the background color is irrelevant (the source video
 *    fills the frame), so an empty value stays empty.
 */

/** Captions-only default background. Green chroma key. */
export const CAPTIONS_ONLY_DEFAULT_BACKGROUND = "#00FF00";

const HEX_3 = /^#[0-9a-fA-F]{3}$/;
const HEX_6 = /^#[0-9a-fA-F]{6}$/;

/**
 * Normalize an arbitrary color string to `#RRGGBB`. Returns `null` when the
 * value is missing/empty or not a valid 3- or 6-digit hex color.
 */
export function normalizeHexColor(value: string | null | undefined): string | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
	// Expand shorthand (#rgb -> #rrggbb).
	let expanded = withHash;
	if (withHash.length === 4 && HEX_3.test(withHash)) {
		expanded = `#${withHash[1]}${withHash[1]}${withHash[2]}${withHash[2]}${withHash[3]}${withHash[3]}`;
	}
	if (HEX_6.test(expanded)) {
		return expanded.toUpperCase();
	}
	return null;
}

/**
 * Resolve the captions-only background color for the render route.
 *
 * - Valid hex -> normalized, uppercased.
 * - Missing / empty / "transparent" -> canonical green default.
 * - White is preserved (it is a valid explicit selection).
 */
export function resolveCaptionsOnlyBackground(
	value: string | null | undefined,
): string {
	const normalized = normalizeHexColor(value);
	if (normalized) return normalized;
	return CAPTIONS_ONLY_DEFAULT_BACKGROUND;
}

/**
 * Resolve the background color for a given render mode. Full-video mode keeps
 * the raw value (the source video fills the frame, so the color is unused by
 * the composition). Captions-only mode applies the green default when absent.
 */
export function resolveRenderBackground(
	renderMode: string | null | undefined,
	value: string | null | undefined,
): string {
	if (isCaptionsOnlyMode(renderMode)) {
		return resolveCaptionsOnlyBackground(value);
	}
	// Full-video: transparent overlay over the original video. Preserve the
	// value as-is (the composition root is never visible behind the video).
	return value && value.trim() ? value.trim() : "transparent";
}

/** Whether a render mode is a captions-only / solid-background variant. */
export function isCaptionsOnlyMode(
	renderMode: string | null | undefined,
): boolean {
	return (
		renderMode === "captions_only" ||
		renderMode === "captions_only_solid_background" ||
		renderMode === "captions_solid_background"
	);
}
