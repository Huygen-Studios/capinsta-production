export type CapinstaFontStyle = "normal" | "italic";
export type CapinstaFontFormat = "truetype" | "opentype" | "woff" | "woff2";

export interface CapinstaFontFaceDefinition {
	file: string;
	weight: number;
	style: CapinstaFontStyle;
	format: CapinstaFontFormat;
}

export interface CapinstaFontDefinition {
	id: string;
	label: string;
	cssFamily: string;
	exportFamily: string;
	aliases?: string[];
	faces: CapinstaFontFaceDefinition[];
	fallback?: boolean;
}

function face(
	file: string,
	weight: number,
	style: CapinstaFontStyle = "normal",
): CapinstaFontFaceDefinition {
	const extension = file.split(".").at(-1)?.toLocaleLowerCase();
	const format: CapinstaFontFormat =
		extension === "otf"
			? "opentype"
			: extension === "woff"
				? "woff"
				: extension === "woff2"
					? "woff2"
					: "truetype";
	return { file, weight, style, format };
}

export const CAPINSTA_FONT_REGISTRY: readonly CapinstaFontDefinition[] = [
	{
		id: "komika-axis",
		label: "Komika Axis",
		cssFamily: "Komika Axis",
		exportFamily: "Komika Axis",
		aliases: ["KomikaAxis", "KOMIKAX_"],
		faces: [
			face("KomikaAxis.ttf", 400),
			face("KomikaAxis.ttf", 700),
			face("KomikaAxis.ttf", 900),
		],
	},
	{
		id: "poppins",
		label: "Poppins",
		cssFamily: "Poppins",
		exportFamily: "Poppins",
		faces: [
			face("Poppins Font family/Poppins-Regular.ttf", 400),
			face("Poppins Font family/Poppins-Medium.ttf", 500),
			face("Poppins Font family/Poppins-SemiBold.ttf", 600),
			face("Poppins Font family/Poppins-Bold.ttf", 700),
			face("Poppins Font family/Poppins-ExtraBold.ttf", 800),
			face("Poppins Font family/Poppins-Black.ttf", 900),
			face("Poppins Font family/Poppins-Italic.ttf", 400, "italic"),
			face("Poppins Font family/Poppins-BoldItalic.ttf", 700, "italic"),
			face("Poppins Font family/Poppins-BlackItalic.ttf", 900, "italic"),
		],
	},
	{
		id: "montserrat",
		label: "Montserrat",
		cssFamily: "Montserrat",
		exportFamily: "Montserrat",
		aliases: ["Inter"],
		faces: [
			face("Montserrat fotn family/Montserrat-Regular.ttf", 400),
			face("Montserrat fotn family/Montserrat-Medium.ttf", 500),
			face("Montserrat fotn family/Montserrat-SemiBold.ttf", 600),
			face("Montserrat fotn family/Montserrat-Bold.ttf", 700),
			face("Montserrat fotn family/Montserrat-ExtraBold.ttf", 800),
			face("Montserrat fotn family/Montserrat-Black.ttf", 900),
			face("Montserrat fotn family/Montserrat-Italic.ttf", 400, "italic"),
			face("Montserrat fotn family/Montserrat-BoldItalic.ttf", 700, "italic"),
		],
	},
	{
		id: "losta-masta",
		label: "Losta Masta",
		cssFamily: "Losta Masta",
		exportFamily: "Losta Masta",
		aliases: ["LostaMasta"],
		faces: [
			face("LostaMasta font family/LostaMasta-Regular.ttf", 400),
			face("LostaMasta font family/LostaMasta-Medium.ttf", 500),
			face("LostaMasta font family/LostaMasta-Bold.ttf", 700),
			face("LostaMasta font family/LostaMasta-ExtraBold.ttf", 800),
			face("LostaMasta font family/LostaMasta-Black.ttf", 900),
		],
	},
	{
		id: "made-avenue",
		label: "Made Avenue",
		cssFamily: "Made Avenue",
		exportFamily: "Made Avenue",
		aliases: ["MADE Avenue PERSONAL USE"],
		faces: [
			face("made avenue  font family/MADEAvenuePERSONALUSE-Regular.otf", 400),
		],
	},
	{
		id: "tactic",
		label: "Tactic",
		cssFamily: "Tactic",
		exportFamily: "Tactic",
		aliases: ["Anton"],
		faces: [
			face("tactic font family/TacticSans-Reg.otf", 400),
			face("tactic font family/TacticSans-Med.otf", 500),
			face("tactic font family/TacticSans-Bld.otf", 700),
			face("tactic font family/TacticSans-Blk.otf", 900),
			face("tactic font family/TacticSans-RegIt.otf", 400, "italic"),
			face("tactic font family/TacticSans-BldIt.otf", 700, "italic"),
		],
	},
	{
		id: "8bit-wonder",
		label: "8-BIT WONDER",
		cssFamily: "8BIT WONDER",
		exportFamily: "8BIT WONDER",
		aliases: ["8-BIT WONDER"],
		faces: [face("8-BIT WONDER.TTF", 400)],
	},
	{
		id: "black-chancery",
		label: "BlackChancery",
		cssFamily: "BlackChancery",
		exportFamily: "BlackChancery",
		faces: [face("blkchcry.ttf", 400)],
	},
	{
		id: "brushstrike",
		label: "Brushstrike",
		cssFamily: "BRUSHSTRIKE",
		exportFamily: "BRUSHSTRIKE",
		faces: [face("Brushstrike trial.ttf", 400)],
	},
	{
		id: "deltha",
		label: "Deltha",
		cssFamily: "Deltha",
		exportFamily: "Deltha",
		faces: [face("Deltha.ttf", 400)],
	},
	{
		id: "indivisible",
		label: "Indivisible",
		cssFamily: "Indivisible",
		exportFamily: "Indivisible",
		aliases: ["Indivisible Font", "fonnts.com-Indivisible"],
		faces: [
			face("Indivisible font family/fonnts.com-Indivisible_Thin.otf", 100),
			face("Indivisible font family/fonnts.com-Indivisible_Light.otf", 300),
			face("Indivisible font family/fonnts.com-Indivisible.otf", 400),
			face("Indivisible font family/fonnts.com-Indivisible_Medium.otf", 500),
			face("Indivisible font family/fonnts.com-Indivisible_SemiBold.otf", 600),
			face("Indivisible font family/fonnts.com-Indivisible_Bold.otf", 700),
			face("Indivisible font family/fonnts.com-Indivisible_Black.otf", 900),
			face("Indivisible font family/fonnts.com-Indivisible_Thin_Italic.otf", 100, "italic"),
			face("Indivisible font family/fonnts.com-Indivisible_Light_Italic.otf", 300, "italic"),
			face("Indivisible font family/fonnts.com-Indivisible_Italic.otf", 400, "italic"),
			face("Indivisible font family/fonnts.com-Indivisible_Medium_Italic.otf", 500, "italic"),
			face("Indivisible font family/fonnts.com-Indivisible_SemiBold_Italic.otf", 600, "italic"),
			face("Indivisible font family/fonnts.com-Indivisible_Bold_Italic.otf", 700, "italic"),
			face("Indivisible font family/fonnts.com-Indivisible_Black_Italic.otf", 900, "italic"),
		],
	},
	{
		id: "arial",
		label: "Arial",
		cssFamily: "Arial",
		exportFamily: "Arial",
		faces: [],
		fallback: true,
	},
];

export const CAPINSTA_FONT_STACKS: Record<string, string> = Object.fromEntries(
	CAPINSTA_FONT_REGISTRY.flatMap((definition) => {
		const stack = definition.fallback
			? `"${definition.cssFamily}", sans-serif`
			: `"${definition.cssFamily}"`;
		return [
			[definition.label, stack],
			[definition.cssFamily, stack],
			...(definition.aliases ?? []).map((alias) => [alias, stack]),
		];
	}),
);

export const CAPINSTA_CREATOR_FONTS = CAPINSTA_FONT_REGISTRY.filter(
	(definition) => !definition.fallback,
).map((definition) => definition.label);

function normalizeFontName(value: string): string {
	return value
		.trim()
		.toLocaleLowerCase()
		.replace(/[\s_-]+/g, "");
}

export function resolveCapinstaFont(
	value: string | undefined,
): CapinstaFontDefinition | null {
	if (!value) return null;
	const normalized = normalizeFontName(value);
	return (
		CAPINSTA_FONT_REGISTRY.find((definition) =>
			[
				definition.id,
				definition.label,
				definition.cssFamily,
				...(definition.aliases ?? []),
			].some((candidate) => normalizeFontName(candidate) === normalized),
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

export function resolveCapinstaFontFace({
	definition,
	weight,
	style,
}: {
	definition: CapinstaFontDefinition;
	weight: number;
	style: CapinstaFontStyle;
}): CapinstaFontFaceDefinition | null {
	const matchingStyle = definition.faces.filter((face) => face.style === style);
	const candidates =
		matchingStyle.length > 0
			? matchingStyle
			: definition.faces.filter((face) => face.style === "normal");
	if (candidates.length === 0) return null;
	return candidates.reduce((best, candidate) =>
		Math.abs(candidate.weight - weight) < Math.abs(best.weight - weight)
			? candidate
			: best,
	);
}

export function getCapinstaFontAssetUrl({
	definition,
	weight,
	style = "normal",
}: {
	definition: CapinstaFontDefinition;
	weight: number;
	style?: CapinstaFontStyle;
}): string | null {
	const face = resolveCapinstaFontFace({ definition, weight, style });
	if (!face) return null;
	const base = typeof window !== "undefined" ? window.location.origin : "";
	return `${base}/caption-fonts/${face.file
		.split("/")
		.map((part) => encodeURIComponent(part))
		.join("/")}`;
}

const loadedFaces = new Map<string, Promise<CapinstaFontDefinition>>();
let fontFaceRulesInstalled = false;

export function installCapinstaFontFaceRules(): void {
	if (
		fontFaceRulesInstalled ||
		typeof document === "undefined" ||
		!document.head
	) {
		return;
	}
	const rules = CAPINSTA_FONT_REGISTRY.flatMap((definition) =>
		definition.faces.map(
			(fontFace) => `@font-face {
	font-family: "${definition.cssFamily.replaceAll('"', '\\"')}";
	src: url("/caption-fonts/${fontFace.file
		.split("/")
		.map((part) => encodeURIComponent(part))
		.join("/")}") format("${fontFace.format}");
	font-weight: ${fontFace.weight};
	font-style: ${fontFace.style};
	font-display: block;
}`,
		),
	).join("\n");
	const style = document.createElement("style");
	style.dataset.capinstaFontFaces = "true";
	style.textContent = rules;
	document.head.appendChild(style);
	fontFaceRulesInstalled = true;
}

export async function ensureCapinstaFontLoaded({
	family,
	weight,
	style = "normal",
	strict = false,
}: {
	family: string;
	weight: number;
	style?: CapinstaFontStyle;
	strict?: boolean;
}): Promise<CapinstaFontDefinition> {
	const definition = resolveCapinstaFont(family);
	if (!definition) {
		if (!strict) {
			const fallback = resolveCapinstaFont("Arial");
			if (fallback) return fallback;
		}
		throw new Error(`Unsupported caption font "${family}".`);
	}
	if (typeof document === "undefined" || !document.fonts) return definition;
	installCapinstaFontFaceRules();

	const descriptor = `${style} ${weight} 32px "${definition.cssFamily}"`;
	const faceDefinition = resolveCapinstaFontFace({
		definition,
		weight,
		style,
	});
	const assetUrl = getCapinstaFontAssetUrl({ definition, weight, style });
	if (!assetUrl || !faceDefinition) {
		await document.fonts.ready;
		if (definition.fallback && document.fonts.check(descriptor))
			return definition;
		if (strict) {
			throw new Error(
				`Caption font "${definition.label}" has no bundled face for weight ${weight} and style ${style}.`,
			);
		}
		return definition;
	}

	const key = `${definition.id}:${faceDefinition.weight}:${faceDefinition.style}`;
	let pending = loadedFaces.get(key);
	if (!pending) {
		pending = (async () => {
			const response = await fetch(assetUrl);
			if (!response.ok) {
				throw new Error(
					`Failed to load caption font "${definition.label}". Family="${definition.cssFamily}" file="${faceDefinition.file}" url="${assetUrl}" status=${response.status} origin="${window.location.origin}".`,
				);
			}
			const bytes = await response.arrayBuffer();
			const face = new FontFace(definition.cssFamily, bytes, {
				weight: String(faceDefinition.weight),
				style: faceDefinition.style,
			});
			document.fonts.add(face);
			try {
				await face.load();
			} catch (error) {
				throw new Error(
					`Failed to decode caption font "${definition.label}". Family="${definition.cssFamily}" file="${faceDefinition.file}" url="${assetUrl}" origin="${window.location.origin}": ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
			await document.fonts.load(descriptor);
			await document.fonts.ready;
			if (!document.fonts.check(descriptor)) {
				throw new Error(
					`Caption font "${definition.label}" loaded from ${assetUrl} but failed document.fonts.check("${descriptor}").`,
				);
			}
			return definition;
		})();
		loadedFaces.set(key, pending);
	}
	return pending;
}
