import type { RenderMediaProgress } from "@remotion/renderer";

export type StructuredRenderProgress = RenderMediaProgress & {
	event: "remotion_render_progress";
	totalFrames: number;
};

export class ProgressSampler {
	#lastBucket = -1;
	#lastStage = "";
	constructor(private readonly totalFrames: () => number) {}

	convert(progress: RenderMediaProgress): StructuredRenderProgress {
		return { event: "remotion_render_progress", totalFrames: this.totalFrames(), ...progress };
	}

	shouldLog(progress: RenderMediaProgress): boolean {
		const bucket = Math.floor(progress.progress * 20);
		if (bucket > this.#lastBucket || progress.stitchStage !== this.#lastStage || progress.progress >= 1) {
			this.#lastBucket = bucket;
			this.#lastStage = progress.stitchStage;
			return true;
		}
		return false;
	}
}
