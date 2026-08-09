import { resolveCapinstaClipStyle } from "../../web/src/capinsta/styles/styleMigration";
import { toOriginalCaptionStyleConfig } from "../../web/src/capinsta/originalAdapter";
import type { CapInstaRemotionPropsV1 } from "./contracts";

export type SparseOverlayPlan = { renderFrames: number[]; sourceFrameForTimelineFrame: number[] };

export function planOrdinaryHeldOverlay(props: CapInstaRemotionPropsV1): SparseOverlayPlan {
	const document = props.captions?.document;
	if (!document) return { renderFrames: [], sourceFrameForTimelineFrame: [] };
	if (document.clips.some((clip) => (clip.stylePresetId ?? document.stylePresetId) !== "word_highlight_box")) {
		throw new Error("Sparse overlay prototype is restricted to the audited word_highlight_box renderer");
	}
	const wordsById = new Map(document.words.map((word) => [word.id, word]));
	const stateFrames = new Map<string, number>();
	const sourceFrameForTimelineFrame: number[] = [];
	const totalFrames = Math.max(1, Math.round(props.timeline.edl.outputDurationMs * props.export.fps / 1000));
	for (let frame = 0; frame < totalFrames; frame++) {
		const time = frame / props.export.fps;
		const clip = document.clips.find((candidate) => candidate.start <= time && time < candidate.end);
		let key = "blank";
		if (clip) {
			const style = resolveCapinstaClipStyle({ document, clip });
			const config = toOriginalCaptionStyleConfig({ style });
			const words = clip.wordIds.map((id) => wordsById.get(id)!).filter(Boolean);
			const activeIndex = words.findIndex((word) => word.start <= time && time < word.end);
			const visibleCount = words.filter((word) => word.start <= time).length;
			const clipAgeFrames = (time - clip.start) * props.export.fps;
			const entranceFrames = Math.max(2, 8 / Math.max(0.4, config.animationSpeed));
			const entranceDynamic = config.entranceAnimation !== "none" && config.entranceAnimation !== "hard_cut" && clipAgeFrames <= entranceFrames;
			let wordDynamic = false;
			if (activeIndex >= 0 && config.animationType !== "none" && config.animationStrength > 0 && ["highlight", "bounce", "pop"].includes(config.wordEffect)) {
				const wordAgeFrames = (time - words[activeIndex]!.start) * props.export.fps;
				const speed = Math.max(0.4, config.animationSpeed);
				const peakFrame = Math.max(2, (3 + Math.max(0, Math.min(1, config.animationSmoothness)) * 2) / speed);
				const settleFrame = Math.max(peakFrame + 2, (8 + Math.max(0, Math.min(1, config.animationSmoothness)) * 4) / speed);
				wordDynamic = wordAgeFrames <= settleFrame;
			}
			key = entranceDynamic || wordDynamic ? `frame:${frame}` : `held:${clip.id}:${activeIndex}:${visibleCount}`;
		}
		const stateFrame = stateFrames.get(key) ?? frame;
		stateFrames.set(key, stateFrame);
		sourceFrameForTimelineFrame.push(stateFrame);
	}
	return { renderFrames: [...new Set(sourceFrameForTimelineFrame)], sourceFrameForTimelineFrame };
}
