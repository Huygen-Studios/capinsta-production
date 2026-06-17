import type { NeutralCaptionClip, NeutralCaptionWord } from "../types";

export function getCapinstaActiveWordIds({
	clip,
	words,
	timeSeconds,
}: {
	clip: NeutralCaptionClip;
	words: NeutralCaptionWord[];
	timeSeconds: number;
}): string[] {
	const clipWordIds = new Set(clip.wordIds);
	return words
		.filter((word) => clipWordIds.has(word.id))
		.filter((word) => word.start <= timeSeconds && timeSeconds < word.end)
		.map((word) => word.id);
}
