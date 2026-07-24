/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- fixture traversal verifies an intentionally untyped migration boundary */
import { describe, expect, test } from "bun:test";
import { PAPER_FOLD_DEFAULTS } from "@/effects/paper-fold/types";
import { transformProjectV34ToV35 } from "../transformers/v34-to-v35";

describe("V34 to V35 Paper Fold migration", () => {
	test("fills missing Paper Fold fields without replacing stored values", () => {
		const result = transformProjectV34ToV35({
			project: {
				id: "project-1",
				version: 34,
				scenes: [
					{
						tracks: {
							main: {
								elements: [
									{
										type: "video",
										effects: [
											{
												id: "fold-1",
												type: "paper-fold",
												enabled: true,
												params: { mode: "manual", progress: 0.42 },
											},
										],
									},
								],
							},
							overlay: [],
							audio: [],
						},
					},
				],
			},
		});
		expect(result.skipped).toBe(false);
		expect(result.project.version).toBe(35);
		const scenes = result.project.scenes as Array<Record<string, unknown>>;
		const tracks = scenes[0].tracks as Record<string, unknown>;
		const main = tracks.main as { elements: Array<Record<string, unknown>> };
		const effects = main.elements[0].effects as Array<{
			params: Record<string, unknown>;
		}>;
		expect(effects[0].params.mode).toBe("manual");
		expect(effects[0].params.progress).toBe(0.42);
		expect(effects[0].params.paperColor).toBe(PAPER_FOLD_DEFAULTS.paperColor);
		expect(effects[0].params.schemaVersion).toBe(1);
	});
});
