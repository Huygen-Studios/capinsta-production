import { describe, expect, test } from "bun:test";
import { textOverlaysFromComposition } from "./automaticHookOverlay";

describe("automatic hook render input", () => {
	test("extracts only the bounded editable hook with Unicode emoji", () => {
		const overlays = textOverlaysFromComposition({
			scenes: [
				{
					tracks: {
						overlay: [
							{
								id: "project__automatic_hook",
								name: "Automatic hook",
								elements: [
									{
										id: "hook",
										startTime: 12_000,
										duration: 240_000,
										params: {
											content: "Watch this 👨🏽‍💻",
											fontFamily: "Poppins, Noto Color Emoji",
											"transform.positionY": -560,
											"background.enabled": true,
										},
									},
								],
							},
							{ id: "captions", name: "Captions", elements: [] },
						],
					},
				},
			],
		});

		expect(overlays).toHaveLength(1);
		expect(overlays[0]).toMatchObject({
			id: "hook",
			text: "Watch this 👨🏽‍💻",
			start: 0.1,
			end: 2.1,
			fontFamily: "Poppins, Noto Color Emoji",
			positionY: -560,
			backgroundEnabled: true,
		});
		expect(textOverlaysFromComposition({ scenes: [null, "bad"] })).toEqual([]);
	});
});
