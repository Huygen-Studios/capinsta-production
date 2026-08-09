import {
	type EditDecisionListV1,
	validateEditDecisionListV1,
} from "@capinsta/transcript-contract";
import { z } from "zod";
import type { NeutralCaptionDocument } from "../../web/src/capinsta/types";
import { ensureCapinstaDocumentStyles } from "../../web/src/capinsta/styles/styleMigration";

export const REMOTION_INPUT_VERSION = 1 as const;
export const REMOTION_COMPOSITION_ID = "CapInstaExport";
export const REMOTION_OVERLAY_COMPOSITION_ID = "CapInstaOverlay";

export const qualityCrf = {
	fast: 28,
	draft: 28,
	standard: 23,
	balanced: 23,
	high: 18,
	best: 16,
} as const;

export type CapInstaExportQuality = keyof typeof qualityCrf;

export type CapInstaRemotionSourceV1 = {
	id: string;
	url: string;
	hasAudio: boolean;
	muted?: boolean;
	requestInit?: {
		cache?: RequestCache;
		credentials?: RequestCredentials;
		headers?: Record<string, string>;
	};
	accessMode: "remote" | "localized";
};

export type CapInstaRemotionPropsV1 = {
	version: 1;
	export: {
		width: number;
		height: number;
		fps: number;
		quality: CapInstaExportQuality;
		backgroundColor: string;
	};
	media: { sources: CapInstaRemotionSourceV1[] };
	timeline: { edl: EditDecisionListV1 };
	captions?: { document: NeutralCaptionDocument };
};

const exportSchema = z.object({
	width: z.number().int().min(2).max(7680).refine((value) => value % 2 === 0),
	height: z.number().int().min(2).max(7680).refine((value) => value % 2 === 0),
	fps: z.number().int().min(1).max(60),
	quality: z.enum(Object.keys(qualityCrf) as [CapInstaExportQuality, ...CapInstaExportQuality[]]),
	backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i),
});

const isLocalizedUrl = (value: string) => /^\/[-A-Za-z0-9_./%]+$/.test(value) || /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/[-A-Za-z0-9_./%]+$/.test(value);

const sourceSchema = z.object({
	id: z.string().min(1).max(200),
	url: z.string().min(1).refine((value) => value.startsWith("https://") || isLocalizedUrl(value)),
	hasAudio: z.boolean(),
	muted: z.boolean().optional(),
	requestInit: z
		.object({
			cache: z.enum(["default", "no-store", "reload", "no-cache", "force-cache", "only-if-cached"]).optional(),
			credentials: z.enum(["omit", "same-origin", "include"]).optional(),
			headers: z.record(z.string(), z.string()).optional(),
		})
		.optional(),
	accessMode: z.enum(["remote", "localized"]),
}).superRefine((source, context) => {
	if (source.accessMode === "remote" && !source.url.startsWith("https://")) context.addIssue({ code: "custom", message: "Remote media must use HTTPS" });
	if (source.accessMode === "localized" && !isLocalizedUrl(source.url)) context.addIssue({ code: "custom", message: "Localized media must use a bundle-relative or loopback URL" });
});

const captionDocumentSchema = z
	.object({
		id: z.string().min(1),
		trackId: z.string().min(1),
		durationSeconds: z.number().nonnegative(),
		stylePresetId: z.string().min(1),
		clips: z.array(
			z.object({
				id: z.string().min(1),
				start: z.number().nonnegative(),
				end: z.number().positive(),
				wordIds: z.array(z.string()),
			}).passthrough(),
		),
		words: z.array(
			z.object({
				id: z.string().min(1),
				start: z.number().nonnegative(),
				end: z.number().positive(),
				text: z.string(),
				displayedText: z.string(),
			}).passthrough(),
		),
	})
	.passthrough()
	.superRefine((document, context) => {
		const wordIds = new Set(document.words.map((word) => word.id));
		for (const clip of document.clips) {
			if (clip.end <= clip.start) context.addIssue({ code: "custom", message: `Caption ${clip.id} has invalid timing` });
			for (const wordId of clip.wordIds) {
				if (!wordIds.has(wordId)) context.addIssue({ code: "custom", message: `Caption ${clip.id} references missing word ${wordId}` });
			}
		}
	});

const propsSchema = z.object({
	version: z.literal(REMOTION_INPUT_VERSION),
	export: exportSchema,
	media: z.object({ sources: z.array(sourceSchema).min(1).max(100) }),
	timeline: z.object({ edl: z.unknown() }),
	captions: z.object({ document: captionDocumentSchema }).optional(),
});

export function validateRemotionProps(value: unknown): CapInstaRemotionPropsV1 {
	const parsed = propsSchema.parse(value);
	const edl = validateEditDecisionListV1(parsed.timeline.edl);
	const sourceIds = new Set(parsed.media.sources.map((source) => source.id));
	if (sourceIds.size !== parsed.media.sources.length) throw new Error("Duplicate source media ID");
	if (edl.entries.length === 0) throw new Error("The Remotion timeline is empty");
	for (const entry of edl.entries) {
		if (!sourceIds.has(entry.sourceMediaId)) throw new Error(`Missing source media ${entry.sourceMediaId}`);
		if (!(entry.playbackRate > 0)) throw new Error("Reverse or zero playback is unsupported");
	}
	return {
		...parsed,
		timeline: { edl },
		captions: parsed.captions
			? { document: ensureCapinstaDocumentStyles(parsed.captions.document as unknown as NeutralCaptionDocument) }
			: undefined,
	} as CapInstaRemotionPropsV1;
}

export function frameFromMilliseconds(milliseconds: number, fps: number): number {
	return Math.round((milliseconds * fps) / 1000);
}

export function metadataForProps(props: CapInstaRemotionPropsV1) {
	return {
		width: props.export.width,
		height: props.export.height,
		fps: props.export.fps,
		durationInFrames: Math.max(1, frameFromMilliseconds(props.timeline.edl.outputDurationMs, props.export.fps)),
	};
}

export function sequencesForProps(props: CapInstaRemotionPropsV1) {
	return props.timeline.edl.entries.map((entry) => {
		const from = frameFromMilliseconds(entry.outputStartMs, props.export.fps);
		const end = frameFromMilliseconds(entry.outputEndMs, props.export.fps);
		return {
			entry,
			from,
			durationInFrames: end - from,
			trimBefore: frameFromMilliseconds(entry.sourceStartMs, props.export.fps),
			trimAfter: frameFromMilliseconds(entry.sourceEndMs, props.export.fps),
		};
	});
}

export function expectsAudio(props: CapInstaRemotionPropsV1): boolean {
	return props.media.sources.some((source) => source.hasAudio && !source.muted);
}
