import type {
	CapinstaCaptionDocumentRecord,
	NeutralCaptionClip,
	NeutralCaptionDocument,
} from "../types";
import { getCapinstaPresetStyle } from "./presetRegistry";
import { normalizeCapinstaCaptionStyle, mergeCapinstaCaptionStyle } from "./styleValidation";
import type {
	CapinstaCaptionPresetId,
	CapinstaCaptionStylePatch,
	CapinstaCaptionStyleV1,
} from "./styleTypes";

function resolveDocumentStyle(document: NeutralCaptionDocument): CapinstaCaptionStyleV1 {
	return normalizeCapinstaCaptionStyle(
		document.style ?? getCapinstaPresetStyle(document.stylePresetId),
	);
}

function mergeStylePatch({
	base,
	patch,
}: {
	base: CapinstaCaptionStylePatch | undefined;
	patch: CapinstaCaptionStylePatch;
}): CapinstaCaptionStylePatch {
	return {
		...base,
		...patch,
		text: { ...base?.text, ...patch.text },
		background: { ...base?.background, ...patch.background },
		outline: { ...base?.outline, ...patch.outline },
		shadow: { ...base?.shadow, ...patch.shadow },
		activeWord: { ...base?.activeWord, ...patch.activeWord },
		animation: { ...base?.animation, ...patch.animation },
		layout: { ...base?.layout, ...patch.layout },
		effects: { ...base?.effects, ...patch.effects },
		reveal: { ...base?.reveal, ...patch.reveal },
		lockup: { ...base?.lockup, ...patch.lockup },
		chunking: { ...base?.chunking, ...patch.chunking },
	};
}

export function resolveCapinstaClipStyle({
	document,
	clip,
}: {
	document: NeutralCaptionDocument;
	clip: NeutralCaptionClip;
}): CapinstaCaptionStyleV1 {
	const documentStyle = resolveDocumentStyle(document);
	if (clip.styleOverrides) {
		return normalizeCapinstaCaptionStyle(
			mergeCapinstaCaptionStyle(documentStyle, clip.styleOverrides),
		);
	}
	return normalizeCapinstaCaptionStyle(clip.style ?? documentStyle);
}

export function ensureCapinstaDocumentStyles(
	document: NeutralCaptionDocument,
): NeutralCaptionDocument {
	const documentStyle = resolveDocumentStyle(document);
	return {
		...document,
		stylePresetId: documentStyle.presetId,
		style: documentStyle,
		clips: document.clips.map((clip) => ({
			...clip,
			styleOverrides: clip.styleOverrides,
		})),
	};
}

export function migrateCapinstaCaptionDocumentRecords(
	records: CapinstaCaptionDocumentRecord[],
): CapinstaCaptionDocumentRecord[] {
	return records.map((record) => ({
		...record,
		document: ensureCapinstaDocumentStyles(record.document),
	}));
}

export function applyCapinstaPresetToClipStyle({
	record,
	clipId,
	presetId,
}: {
	record: CapinstaCaptionDocumentRecord;
	clipId: string;
	presetId: CapinstaCaptionPresetId;
}): CapinstaCaptionDocumentRecord {
	const style = getCapinstaPresetStyle(presetId);
	return {
		...record,
		document: {
			...record.document,
			clips: record.document.clips.map((clip) =>
				clip.id === clipId
					? {
							...clip,
							stylePresetId: presetId,
							style: undefined,
							styleOverrides: style,
						}
					: { ...clip },
			),
		},
	};
}

export function updateCapinstaDocumentStyle({
	record,
	patch,
}: {
	record: CapinstaCaptionDocumentRecord;
	patch: CapinstaCaptionStylePatch;
}): CapinstaCaptionDocumentRecord {
	const nextStyle = normalizeCapinstaCaptionStyle(
		mergeCapinstaCaptionStyle(resolveDocumentStyle(record.document), patch),
	);
	return {
		...record,
		document: {
			...record.document,
			stylePresetId: nextStyle.presetId,
			style: nextStyle,
			clips: record.document.clips.map((clip) => ({
				...clip,
				style: undefined,
				styleOverrides: undefined,
				stylePresetId: nextStyle.presetId,
			})),
		},
	};
}

export function resetCapinstaDocumentToPreset({
	record,
	presetId,
}: {
	record: CapinstaCaptionDocumentRecord;
	presetId: CapinstaCaptionPresetId;
}): CapinstaCaptionDocumentRecord {
	const style = getCapinstaPresetStyle(presetId);
	return {
		...record,
		document: {
			...record.document,
			stylePresetId: presetId,
			style,
			clips: record.document.clips.map((clip) => ({
				...clip,
				style: undefined,
				styleOverrides: undefined,
				stylePresetId: presetId,
			})),
		},
	};
}

export function resetCapinstaClipStyleOverrides({
	record,
	clipId,
}: {
	record: CapinstaCaptionDocumentRecord;
	clipId: string;
}): CapinstaCaptionDocumentRecord {
	return {
		...record,
		document: {
			...record.document,
			clips: record.document.clips.map((clip) =>
				clip.id === clipId
					? {
							...clip,
							style: undefined,
							styleOverrides: undefined,
							stylePresetId: record.document.stylePresetId,
						}
					: { ...clip },
			),
		},
	};
}

export function updateCapinstaClipStyle({
	record,
	clipId,
	patch,
}: {
	record: CapinstaCaptionDocumentRecord;
	clipId: string;
	patch: CapinstaCaptionStylePatch;
}): CapinstaCaptionDocumentRecord {
	return {
		...record,
		document: {
			...record.document,
			clips: record.document.clips.map((clip) => {
				if (clip.id !== clipId) return { ...clip };
				return {
					...clip,
					style: undefined,
					styleOverrides: mergeStylePatch({
						base: clip.styleOverrides,
						patch,
					}),
				};
			}),
		},
	};
}
