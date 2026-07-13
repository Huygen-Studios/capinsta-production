import { describe, expect, test } from "bun:test";
import { transformProjectV31ToV32 } from "../transformers/v31-to-v32";
import { asRecord, asRecordArray } from "./helpers";

describe("V31 to V32 Migration", () => {
	test("normalizes malformed motion-template state", () => {
		const result = transformProjectV31ToV32({
			project: {
				id: "project-motion-template",
				version: 31,
				scenes: [
					{
						tracks: {
							main: { elements: [] },
							overlay: [
								{
									elements: [
										{
											id: "template-1",
											type: "motion-template",
											templateId: "position-dance",
											templateVersion: Number.NaN,
											slotOrder: ["slot-3", "unknown", "slot-3"],
											slotBindings: {
												"slot-3": {
													mediaId: "media-3",
													fit: "invalid",
													playbackMode: "nonsense",
													crop: { x: 9, y: -9, scale: -1 },
												},
												"slot-1": {
													mediaId: "media-1",
													fit: "contain",
													playbackMode: "freeze",
													crop: { x: 0.25, y: -0.25, scale: 1.5 },
												},
											},
											templateParams: {
												cycleDuration: 0,
												cardRatio: "2:1",
												frameRatio: "bad",
												easing: "bad",
												shadowOpacity: Infinity,
											},
										},
									],
								},
							],
							audio: [],
						},
					},
				],
			},
		});

		expect(result.skipped).toBe(false);
		expect(result.project.version).toBe(32);
		const scene = asRecordArray(result.project.scenes)[0];
		const overlayTrack = asRecordArray(asRecord(scene.tracks).overlay)[0];
		const overlay = asRecordArray(overlayTrack.elements);
		const element = overlay[0];
		expect(element.templateVersion).toBe(1);
		expect(element.slotOrder).toEqual([
			"slot-3",
			"slot-1",
			"slot-2",
			"slot-4",
			"slot-5",
			"slot-6",
		]);
		const bindings = asRecord(element.slotBindings);
		expect(asRecord(bindings["slot-3"]).crop).toEqual({
			x: 1,
			y: -1,
			scale: 0.25,
		});
		expect(asRecord(bindings["slot-1"]).fit).toBe("contain");
		const params = asRecord(element.templateParams);
		expect(params.cycleDuration).toBe(1);
		expect(params.cardRatio).toBe("1:1");
		expect(params.frameRatio).toBe("1:1");
		expect(params.easing).toBe("smooth");
		expect(params.shadowOpacity).toBe(0.3);
	});

	test("preserves unknown templates without crashing", () => {
		const result = transformProjectV31ToV32({
			project: {
				id: "unknown-template",
				version: 31,
				scenes: [
					{
						tracks: {
							main: { elements: [] },
							overlay: [
								{
									elements: [
										{
											id: "template-unknown",
											type: "motion-template",
											templateId: "removed-template",
											slotBindings: { custom: { mediaId: "m1" } },
										},
									],
								},
							],
							audio: [],
						},
					},
				],
			},
		});

		expect(result.skipped).toBe(false);
		const scene = asRecordArray(result.project.scenes)[0];
		const overlayTrack = asRecordArray(asRecord(scene.tracks).overlay)[0];
		const element = asRecordArray(overlayTrack.elements)[0];
		expect(element.templateId).toBe("removed-template");
		expect(element.slotBindings).toEqual({ custom: { mediaId: "m1" } });
		expect(element.templateVersion).toBe(0);
	});
});
