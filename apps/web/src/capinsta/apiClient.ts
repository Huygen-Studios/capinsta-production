/* eslint-disable opencut/prefer-object-params, @typescript-eslint/no-unsafe-type-assertion -- Fetch response boundaries and Error constructors require narrow adapter casts. */
import type {
	CapinstaApiSegment,
	CapinstaApiWord,
	CapinstaHealthResponse,
	CapinstaJobCreateResponse,
	CapinstaJobDetailResponse,
	CapinstaTranscriptNormalizeInput,
	StartCapinstaCaptionJobInput,
} from "./apiTypes";
import type {
	CapinstaLanguageMode,
	CapinstaTimingSource,
	CapinstaTranscriptV1,
} from "./types";
import { validateCapinstaTranscriptV1 } from "./adapter";
import { CAPINSTA_PRESET_IDS } from "./styles/presetRegistry";
import type { CapinstaCaptionPresetId } from "./styles/styleTypes";
import { authenticatedFetch } from "@/lib/supabase/authenticated-fetch";

export class CapinstaApiError extends Error {
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
		this.name = "CapinstaApiError";
	}
}

function joinUrl(baseUrl: string, path: string): string {
	return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
	if (!response.ok) {
		let detail = response.statusText;
		let code: string | undefined;
		let stage: string | undefined;
		let correlationId = response.headers.get("x-correlation-id") ?? undefined;
		try {
			const body = await response.json();
			if (typeof body?.detail === "string") detail = body.detail;
			else if (typeof body?.message === "string") detail = body.message;
			else if (typeof body?.error === "string") detail = body.error;
			if (typeof body?.code === "string") code = body.code;
			if (typeof body?.stage === "string") stage = body.stage;
			if (typeof body?.correlationId === "string") {
				correlationId = body.correlationId;
			}
		} catch {
			// Keep the status text when the response is not JSON.
		}
		const diagnostics = [
			`HTTP ${response.status}`,
			stage ? `stage=${stage}` : null,
			code ? `code=${code}` : null,
			correlationId ? `correlation=${correlationId}` : null,
		].filter((value): value is string => Boolean(value));
		throw new CapinstaApiError(
			`${detail || "Capinsta request failed"} (${diagnostics.join(", ")})`,
			response.status,
		);
	}
	return (await response.json()) as T;
}

export async function checkCapinstaHealth({
	baseUrl,
	fetchImpl = fetch,
	signal,
}: {
	baseUrl: string;
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}): Promise<CapinstaHealthResponse> {
	if (!baseUrl) throw new CapinstaApiError("Capinsta backend URL is missing");
	const response = await fetchImpl(joinUrl(baseUrl, "/health"), { signal });
	return readJsonResponse<CapinstaHealthResponse>(response);
}

export async function startCapinstaCaptionJob({
	baseUrl,
	file,
	languageMode,
	fetchImpl = fetch,
	signal,
}: StartCapinstaCaptionJobInput & {
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}): Promise<CapinstaJobCreateResponse> {
	if (!baseUrl) throw new CapinstaApiError("Capinsta backend URL is missing");
	const formData = new FormData();
	formData.append("languageMode", languageMode);
	formData.append("file", file);
	console.debug("[Capinsta captions] Upload request", {
		endpoint: "/api/jobs",
		fileName: file.name,
		fileType: file.type,
		fileSize: file.size,
		languageMode,
	});

	const response = await authenticatedFetch(
		joinUrl(baseUrl, "/api/jobs"),
		{
			method: "POST",
			body: formData,
			signal,
		},
		fetchImpl,
	);
	const job = await readJsonResponse<CapinstaJobCreateResponse>(response);
	console.debug("[Capinsta captions] Job creation response", job);
	return job;
}

export async function getCapinstaJob({
	baseUrl,
	jobId,
	fetchImpl = fetch,
	signal,
}: {
	baseUrl: string;
	jobId: string;
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}): Promise<CapinstaJobDetailResponse> {
	const response = await authenticatedFetch(
		joinUrl(baseUrl, `/api/jobs/${jobId}`),
		{
			signal,
		},
		fetchImpl,
	);
	const job = await readJsonResponse<CapinstaJobDetailResponse>(response);
	console.debug("[Capinsta captions] Job detail response", {
		jobId,
		status: job.status,
		progress: job.progress,
		error: job.error,
		hasTranscript: Boolean(job.transcript),
		segmentCount: job.transcript?.segments?.length ?? job.segments?.length ?? 0,
	});
	return job;
}

export async function cancelCapinstaJob({
	baseUrl,
	jobId,
	fetchImpl = fetch,
}: {
	baseUrl: string;
	jobId: string;
	fetchImpl?: typeof fetch;
}): Promise<CapinstaJobCreateResponse> {
	const response = await authenticatedFetch(
		joinUrl(baseUrl, `/api/jobs/${jobId}/cancel`),
		{
			method: "POST",
		},
		fetchImpl,
	);
	return readJsonResponse<CapinstaJobCreateResponse>(response);
}

function normalizeLanguageMode(
	value: string | undefined,
): CapinstaLanguageMode {
	if (
		value === "english" ||
		value === "hinglish" ||
		value === "telgish" ||
		value === "auto_mixed_indian"
	) {
		return value;
	}
	return "auto_mixed_indian";
}

function normalizeTimingSource(
	value: string | undefined,
): CapinstaTimingSource {
	if (
		value === "provider" ||
		value === "whisperx" ||
		value === "stable_ts" ||
		value === "vad_adjusted" ||
		value === "manual" ||
		value === "estimated"
	) {
		return value;
	}
	return "estimated";
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

export async function sendCapinstaProjectHeartbeat({
	baseUrl,
	jobId,
	fetchImpl = fetch,
	signal,
}: {
	baseUrl: string;
	jobId: string;
	fetchImpl?: typeof fetch;
	signal?: AbortSignal;
}): Promise<{ job_id: string; last_seen_at: string; expires_at: string }> {
	if (!baseUrl) throw new CapinstaApiError("Capinsta backend URL is missing");
	const response = await authenticatedFetch(
		joinUrl(baseUrl, `/api/jobs/${jobId}/heartbeat`),
		{
			method: "POST",
			signal,
		},
		fetchImpl,
	);
	return readJsonResponse(response);
}

function wordText(word: CapinstaApiWord): string {
	return (
		word.word ||
		word.text ||
		word.displayedWord ||
		word.displayWord ||
		word.originalWord ||
		""
	).trim();
}

function validTimedWords(
	words: CapinstaApiWord[] | undefined,
): CapinstaApiWord[] {
	return (words ?? []).filter((word) => {
		const start = finiteNumber(word.start);
		const end = finiteNumber(word.end);
		return (
			Boolean(wordText(word)) &&
			start !== undefined &&
			end !== undefined &&
			end > start
		);
	});
}

function segmentWords(segments: CapinstaApiSegment[]): CapinstaApiWord[] {
	return segments.flatMap((segment) =>
		(segment.words ?? []).map((word) => ({
			...word,
			start: finiteNumber(word.start) ?? segment.start,
			end: finiteNumber(word.end) ?? segment.end,
		})),
	);
}

function segmentIndexForWord({
	segments,
	start,
	end,
}: {
	segments: CapinstaApiSegment[];
	start: number;
	end: number;
}): number {
	if (segments.length === 0) return 0;
	const midpoint = start + (end - start) / 2;
	const containingIndex = segments.findIndex(
		(segment) => midpoint >= segment.start && midpoint < segment.end,
	);
	if (containingIndex >= 0) return containingIndex;

	let nearestIndex = 0;
	let nearestDistance = Number.POSITIVE_INFINITY;
	segments.forEach((segment, index) => {
		const distance =
			midpoint < segment.start
				? segment.start - midpoint
				: midpoint > segment.end
					? midpoint - segment.end
					: 0;
		if (distance < nearestDistance) {
			nearestDistance = distance;
			nearestIndex = index;
		}
	});
	return nearestIndex;
}

function normalizePresetId(value: string | undefined): CapinstaCaptionPresetId {
	return CAPINSTA_PRESET_IDS.includes(value as CapinstaCaptionPresetId)
		? (value as CapinstaCaptionPresetId)
		: "word_highlight_box";
}

export function normalizeCapinstaJobToTranscript({
	job,
	sourceAsset,
}: CapinstaTranscriptNormalizeInput): CapinstaTranscriptV1 {
	const segments = job.transcript?.segments ?? job.segments ?? [];
	const canonicalAlignedWords = validTimedWords(job.transcript?.alignedWords);
	const fallbackSegmentWords = validTimedWords(segmentWords(segments));
	const usesCanonicalAlignedWords = canonicalAlignedWords.length > 0;
	const sourceWords = usesCanonicalAlignedWords
		? canonicalAlignedWords
		: fallbackSegmentWords;
	if (sourceWords.length === 0) {
		throw new CapinstaApiError(
			"Capinsta job completed without timed caption words",
		);
	}

	const clipShells =
		segments.length > 0
			? segments.map((segment, index) => ({
					id: segment.id || `capinsta-source-clip-${index + 1}`,
					start: segment.start,
					end: segment.end,
					text: segment.text,
				}))
			: [
					{
						id: "capinsta-source-clip-1",
						start: finiteNumber(sourceWords[0]?.start) ?? 0,
						end: finiteNumber(sourceWords[sourceWords.length - 1]?.end) ?? 0.01,
						text: sourceWords.map(wordText).join(" "),
					},
				];
	const clipWordIds = clipShells.map(() => [] as string[]);
	const words: CapinstaTranscriptV1["words"] = sourceWords
		.map((word, wordIndex) => {
			const text = wordText(word);
			const start = finiteNumber(word.start);
			const end = finiteNumber(word.end);
			if (!text || start === undefined || end === undefined || end <= start)
				return null;
			const clipIndex = segmentIndexForWord({ segments, start, end });
			const clipId = clipShells[clipIndex]?.id ?? clipShells[0]!.id;
			const wordId = `capinsta-aligned-word-${wordIndex + 1}`;
			clipWordIds[clipIndex]?.push(wordId);
			const timingWarning = word.timingWarning || word.timing_warning;
			return {
				id: wordId,
				text,
				displayedText: word.displayedWord || word.displayWord || text,
				start,
				end,
				confidence: finiteNumber(word.confidence),
				score: finiteNumber(word.score),
				provider: word.provider,
				timingSource: normalizeTimingSource(
					word.timingSource || word.timing_source,
				),
				originalText: word.originalWord,
				spokenText: word.spokenWord,
				timingSourceDetail:
					word.timingSourceDetail ||
					word.timing_source ||
					word.timingSource ||
					timingWarning,
				timingWarning,
				timingNeedsReview: Boolean(
					word.timingNeedsReview || word.timingReviewRequired,
				),
				timingRepair: word.timingRepair || word.timing_repair,
				captionClipId: clipId,
			};
		})
		.filter((word): word is NonNullable<typeof word> => word !== null);
	const wordById = new Map(words.map((word) => [word.id, word]));
	const clips: CapinstaTranscriptV1["clips"] = clipShells.map(
		(clip, clipIndex) => {
			const wordIds = clipWordIds[clipIndex] ?? [];
			return {
				...clip,
				wordIds,
				timingNeedsReview: wordIds.some(
					(wordId) => wordById.get(wordId)?.timingNeedsReview,
				),
			};
		},
	);

	if (process.env.NODE_ENV === "development") {
		console.debug("[Capinsta captions] Canonical timing source", {
			source: usesCanonicalAlignedWords
				? "transcript.alignedWords"
				: "segments",
			alignedWordsCount: canonicalAlignedWords.length,
			segmentWordCount: fallbackSegmentWords.length,
			first30AlignedWords: sourceWords.slice(0, 30).map((word) => ({
				word: wordText(word),
				start: word.start,
				end: word.end,
				timing_source:
					word.timingSourceDetail || word.timing_source || word.timingSource,
			})),
		});
	}

	const providerValue = job.transcript?.provider;
	const provider =
		typeof providerValue === "string"
			? { name: providerValue }
			: {
					name: providerValue?.name || "unknown",
					model: providerValue?.model,
				};
	const maxEnd = Math.max(...clips.map((clip) => clip.end));
	const durationSeconds =
		sourceAsset.durationSeconds ||
		finiteNumber(job.transcript?.metadata?.audio?.duration) ||
		maxEnd;
	const silenceGaps =
		job.transcript?.metadata?.timing?.vad?.silenceGaps?.filter(
			(gap) =>
				Number.isFinite(gap.start) &&
				Number.isFinite(gap.end) &&
				gap.end > gap.start,
		) ?? [];
	const speechSegments =
		job.transcript?.metadata?.timing?.vad?.speechSegments?.filter(
			(segment) =>
				Number.isFinite(segment.start) &&
				Number.isFinite(segment.end) &&
				segment.end > segment.start,
		) ?? [];

	return validateCapinstaTranscriptV1({
		version: "capinsta.transcript.v1",
		source: {
			assetId: sourceAsset.assetId,
			assetName: sourceAsset.assetName,
			durationSeconds,
			mimeType: sourceAsset.mimeType,
		},
		languageMode: normalizeLanguageMode(job.languageMode || job.target_lang),
		provider,
		clips,
		words,
		stylePreset: {
			id: normalizePresetId(
				job.transcript?.metadata?.stylePreset?.id as string | undefined,
			),
			name: "Word Highlight Box",
			renderer: "word_highlight_box",
			styleConfig: job.transcript?.metadata?.stylePreset,
			chunkingConfig: {
				targetWordsPerCaption: 2,
				maxWordsPerCaption: 5,
				minWordsPerCaption: 1,
				maxCharsPerCaption: 30,
				minCaptionDuration: 0.18,
				avoidSingleWordCaptions: false,
			},
		},
		manualEdits: {
			notes: [`Generated from Capinsta job ${job.job_id}.`],
		},
		timing: {
			sourceOfTruth: words.length > 0 ? "words" : "clips",
			generatedAt: job.completed_at || new Date().toISOString(),
			audioDurationSeconds: durationSeconds,
			silenceGaps,
			speechSegments,
			report: job.transcript?.metadata?.timing?.report,
			sync: job.transcript?.metadata?.sync,
		},
	});
}
