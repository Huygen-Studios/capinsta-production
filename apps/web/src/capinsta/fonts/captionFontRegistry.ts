import { getCapinstaApiBaseUrl } from "@/capinsta/featureFlags";

export interface CapinstaFontDefinition {
	id: string;
	label: string;
	cssFamily: string;
	exportFamily: string;
	weights: number[];
	styles: Array<"normal" | "italic">;
	sources: Partial<Record<number, string>>;
	system?: boolean;
}

const font = (definition: CapinstaFontDefinition): CapinstaFontDefinition =>
	definition;

export const CAPINSTA_FONT_REGISTRY = [
	font({
		id: "komika-axis",
		label: "Komika Axis",
		cssFamily: "Komika Axis",
		exportFamily: "Komika Axis",
		weights: [400, 700, 900],
		styles: ["normal"],
		sources: {
			400: "KomikaAxis.ttf",
			700: "KomikaAxis.ttf",
			900: "KomikaAxis.ttf",
		},
	}),
	font({
		id: "poppins",
		label: "Poppins",
		cssFamily: "Poppins",
		exportFamily: "Poppins",
		weights: [400, 600, 700, 800, 900],
		styles: ["normal"],
		sources: {
			400: "Poppins Font family/Poppins-Regular.ttf",
			600: "Poppins Font family/Poppins-SemiBold.ttf",
			700: "Poppins Font family/Poppins-Bold.ttf",
			800: "Poppins Font family/Poppins-ExtraBold.ttf",
			900: "Poppins Font family/Poppins-Black.ttf",
		},
	}),
	font({
		id: "montserrat",
		label: "Montserrat",
		cssFamily: "Montserrat",
		exportFamily: "Montserrat",
		weights: [400, 700, 800, 900],
		styles: ["normal"],
		sources: {
			400: "Montserrat fotn family/Montserrat-Regular.ttf",
			700: "Montserrat fotn family/Montserrat-Bold.ttf",
			800: "Montserrat fotn family/Montserrat-ExtraBold.ttf",
			900: "Montserrat fotn family/Montserrat-Black.ttf",
		},
	}),
	font({
		id: "inter",
		label: "Inter",
		cssFamily: "Inter",
		exportFamily: "Inter",
		weights: [400, 600, 700, 900],
		styles: ["normal"],
		sources: {},
	}),
	font({
		id: "anton",
		label: "Anton",
		cssFamily: "Anton",
		exportFamily: "Anton",
		weights: [400, 900],
		styles: ["normal"],
		sources: {},
	}),
	font({
		id: "sf-pro-display",
		label: "SF Pro Display",
		cssFamily: "SF Pro Display",
		exportFamily: "SF Pro Display",
		weights: [400, 600, 700],
		styles: ["normal"],
		sources: {},
	}),
	font({
		id: "arial",
		label: "Arial",
		cssFamily: "Arial",
		exportFamily: "Arial",
		weights: [400, 700, 900],
		styles: ["normal", "italic"],
		sources: {},
		system: true,
	}),
] as const satisfies readonly CapinstaFontDefinition[];

export function resolveCapinstaFont(
	value: string | undefined,
): CapinstaFontDefinition | null {
	if (!value) return null;
	const normalized = value
		.trim()
		.toLocaleLowerCase()
		.replace(/[\s_-]+/g, "");
	return (
		CAPINSTA_FONT_REGISTRY.find((definition) =>
			[definition.id, definition.label, definition.cssFamily].some(
				(candidate) =>
					candidate.toLocaleLowerCase().replace(/[\s_-]+/g, "") === normalized,
			),
		) ?? null
	);
}

export function normalizeCapinstaFontWeight(
	weight: number | "normal" | "bold",
): number {
	if (weight === "normal") return 400;
	if (weight === "bold") return 700;
	return Math.max(100, Math.min(900, Math.round(weight / 100) * 100));
}

export function getCapinstaFontAssetUrl({
	definition,
	weight,
}: {
	definition: CapinstaFontDefinition;
	weight: number;
}): string | null {
	const available = Object.keys(definition.sources).map(Number);
	if (available.length === 0) return null;
	const resolvedWeight = available.reduce((best, candidate) =>
		Math.abs(candidate - weight) < Math.abs(best - weight) ? candidate : best,
	);
	const source = definition.sources[resolvedWeight];
	if (!source) return null;
	const configuredBase = getCapinstaApiBaseUrl();
	const base =
		configuredBase ||
		(typeof window !== "undefined" ? window.location.origin : "");
	return `${base}/caption-fonts/${source
		.split("/")
		.map((part) => encodeURIComponent(part))
		.join("/")}`;
}

const loadedFaces = new Map<string, Promise<CapinstaFontDefinition>>();

export async function ensureCapinstaFontLoaded({
	family,
	weight,
	style = "normal",
	strict = false,
}: {
	family: string;
	weight: number;
	style?: "normal" | "italic";
	strict?: boolean;
}): Promise<CapinstaFontDefinition> {
	const definition = resolveCapinstaFont(family);
	if (!definition) {
		throw new Error(`Unsupported caption font "${family}".`);
	}
	if (typeof document === "undefined" || !document.fonts) return definition;

	const descriptor = `${style} ${weight} 32px "${definition.cssFamily}"`;
	const assetUrl = getCapinstaFontAssetUrl({ definition, weight });
	if (!assetUrl) {
		await document.fonts.ready;
		if (definition.system && document.fonts.check(descriptor))
			return definition;
		if (strict) {
			throw new Error(
				`Caption font "${definition.label}" is not bundled and is unavailable in the export browser.`,
			);
		}
		return definition;
	}

	const key = `${definition.id}:${weight}:${style}`;
	let pending = loadedFaces.get(key);
	if (!pending) {
		pending = (async () => {
			const face = new FontFace(definition.cssFamily, `url("${assetUrl}")`, {
				weight: String(weight),
				style,
			});
			document.fonts.add(face);
			try {
				await face.load();
			} catch (error) {
				throw new Error(
					`Failed to load caption font "${definition.label}" from ${assetUrl}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
			await document.fonts.load(descriptor);
			await document.fonts.ready;
			if (!document.fonts.check(descriptor)) {
				throw new Error(
					`Caption font "${definition.label}" loaded from ${assetUrl} but failed document.fonts.check().`,
				);
			}
			return definition;
		})();
		loadedFaces.set(key, pending);
	}
	return pending;
}
