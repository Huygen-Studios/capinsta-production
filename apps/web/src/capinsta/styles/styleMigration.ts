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

export function resolveCapinstaClipStyle({
	document,
	clip,
}: {
	document: NeutralCaptionDocument;
	clip: NeutralCaptionClip;
}): CapinstaCaptionStyleV1 {
	return normalizeCapinstaCaptionStyle(
		clip.style ?? document.style ?? getCapinstaPresetStyle(clip.stylePresetId || document.stylePresetId),
	);
}

export function ensureCapinstaDocumentStyles(
	document: NeutralCaptionDocument,
): NeutralCaptionDocument {
	const documentStyle = normalizeCapinstaCaptionStyle(
		document.style ?? getCapinstaPresetStyle(document.stylePresetId),
	);
	return {
		...document,
		style: documentStyle,
		clips: document.clips.map((clip) => ({
			...clip,
			style: normalizeCapinstaCaptionStyle(clip.style ?? documentStyle),
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
					? { ...clip, stylePresetId: presetId, style }
					: { ...clip, style: clip.style ? normalizeCapinstaCaptionStyle(clip.style) : clip.style },
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
				const currentStyle = resolveCapinstaClipStyle({
					document: record.document,
					clip,
				});
				return {
					...clip,
					style: normalizeCapinstaCaptionStyle(
						mergeCapinstaCaptionStyle(currentStyle, patch),
					),
				};
			}),
		},
	};
}
