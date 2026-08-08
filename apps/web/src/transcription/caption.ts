import type { TranscriptionSegment, CaptionChunk } from "@/transcription/types";
import {
	DEFAULT_WORDS_PER_CAPTION,
	MIN_CAPTION_DURATION_SECONDS,
} from "@/transcription/caption-defaults";

/**
 * Legacy segment interpolation for static subtitle fallback only.
 *
 * This data has no acoustic word alignment and must never drive production
 * active-word effects. Canonical captions are built by the Rust timing core.
 */
export function buildEstimatedCaptionChunks({
	segments,
	wordsPerChunk = DEFAULT_WORDS_PER_CAPTION,
	minDuration = MIN_CAPTION_DURATION_SECONDS,
}: {
	segments: TranscriptionSegment[];
	wordsPerChunk?: number;
	minDuration?: number;
}): CaptionChunk[] {
	const captions: CaptionChunk[] = [];
	let globalEndTime = 0;

	for (const segment of segments) {
		const words = segment.text.trim().split(/\s+/);
		if (words.length === 0 || (words.length === 1 && words[0] === "")) continue;

		const segmentDuration = segment.end - segment.start;
		const wordsPerSecond = words.length / segmentDuration;

		const chunks: string[] = [];
		for (let i = 0; i < words.length; i += wordsPerChunk) {
			chunks.push(words.slice(i, i + wordsPerChunk).join(" "));
		}

		let chunkStartTime = segment.start;
		for (const chunk of chunks) {
			const chunkWords = chunk.split(/\s+/).length;
			const chunkDuration = Math.max(minDuration, chunkWords / wordsPerSecond);
			const adjustedStartTime = Math.max(chunkStartTime, globalEndTime);

			captions.push({
				text: chunk,
				startTime: adjustedStartTime,
				duration: chunkDuration,
				timingSource: "estimated",
				timingNeedsReview: true,
				activeWordEffectsEnabled: false,
			});

			globalEndTime = adjustedStartTime + chunkDuration;
			chunkStartTime += chunkDuration;
		}
	}

	return captions;
}

/** @deprecated Use Rust-owned canonical word timings. */
export const buildCaptionChunks = buildEstimatedCaptionChunks;
