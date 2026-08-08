import { normalizeCapinstaCaptionStyle } from "@/capinsta/styles/styleValidation";

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(",")}]`;
	}
	if (value && typeof value === "object") {
		return `{${Object.keys(value as Record<string, unknown>)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function hashString(input: string): string {
	let hash = 2166136261;
	for (let index = 0; index < input.length; index += 1) {
		hash ^= input.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

export function summarizeCaptionStyle(style: unknown): Record<string, unknown> {
	const normalized = normalizeCapinstaCaptionStyle(style);
	return {
		text: normalized.text,
		background: normalized.background,
		outline: normalized.outline,
		shadow: normalized.shadow,
		activeWord: normalized.activeWord,
		animation: normalized.animation,
		layout: normalized.layout,
	};
}

export function computeCaptionStyleHash(style: unknown): string {
	return hashString(stableStringify(summarizeCaptionStyle(style)));
}
