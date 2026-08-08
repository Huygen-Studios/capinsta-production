/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Minimal project fixture only supplies fields used by metadata helpers. */
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	CAPINSTA_CAPTION_PRESETS,
	getCapinstaPresetStyle,
} from "./styles/presetRegistry";
import {
	normalizeCapinstaCaptionStyle,
	mergeCapinstaCaptionStyle,
} from "./styles/styleValidation";
import {
	applyCapinstaPresetToClipStyle,
	ensureCapinstaDocumentStyles,
	resolveCapinstaClipStyle,
	updateCapinstaClipStyle,
} from "./styles/styleMigration";
import { styleToExport } from "./styles/styleToExport";
import { styleToPreview } from "./styles/styleToPreview";
import { capinstaTranscriptToCaptionDocument } from "./adapter";
import { sampleCapinstaTranscriptV1 } from "./sampleTranscript";
import { upsertCapinstaCaptionDocument } from "./projectMetadata";
import { CapinstaCaptionRenderer } from "./render/CapinstaCaptionRenderer";
import {
	getCapinstaActiveWordEffectStyle,
	getCapinstaEntranceStyle,
} from "./render/previewMotion";
import type { CapinstaCaptionDocumentRecord } from "./types";
import type { TProject } from "@/project/types";
import type { CapinstaCaptionPresetId } from "./styles/styleTypes";

function recordForDocument(): CapinstaCaptionDocumentRecord {
	return {
		document: capinstaTranscriptToCaptionDocument(sampleCapinstaTranscriptV1),
		openCutTrackId: "caption-track",
		importedAt: "2026-06-16T00:00:00.000Z",
	};
}

const ORIGINAL_PRESET_EXPECTATIONS: Record<
	CapinstaCaptionPresetId,
	{
		name: string;
		description: string;
		fontFamily: string;
		fontSize: number;
		fontWeight: number;
		textColor: string;
		activeWordColor: string;
		backgroundEnabled: boolean;
		backgroundOpacity: number;
		lineHeight: number;
		wordEffect: string;
		animationType: string;
		animationStrength: number;
		animationSpeed: number;
		animationSmoothness: number;
		entranceAnimation: string;
		positionX: number;
		positionY: number;
		maxWidth: number;
		targetWordsPerCaption: number;
		maxWordsPerCaption: number;
		minWordsPerCaption: number;
		maxCharsPerCaption: number;
		minCaptionDuration: number;
		maxCaptionDuration: number;
	}
> = {
	word_highlight_box: {
		name: "Word Highlight Box",
		description: "Clean creator captions with active-word highlighting.",
		fontFamily: "Poppins",
		fontSize: 54,
		fontWeight: 900,
		textColor: "#FFFFFF",
		activeWordColor: "#FFD43B",
		backgroundEnabled: true,
		backgroundOpacity: 1,
		lineHeight: 1.12,
		wordEffect: "pop",
		animationType: "pop",
		animationStrength: 0.55,
		animationSpeed: 1,
		animationSmoothness: 0.72,
		entranceAnimation: "none",
		positionX: 50,
		positionY: 78,
		maxWidth: 82,
		targetWordsPerCaption: 3,
		maxWordsPerCaption: 4,
		minWordsPerCaption: 1,
		maxCharsPerCaption: 34,
		minCaptionDuration: 0.35,
		maxCaptionDuration: 2.2,
	},
	attention_punch: {
		name: "Attention Punch",
		description: "Bold outlined words with punchy active-word emphasis.",
		fontFamily: "Tactic",
		fontSize: 64,
		fontWeight: 900,
		textColor: "#FFFFFF",
		activeWordColor: "#FFD43B",
		backgroundEnabled: false,
		backgroundOpacity: 0,
		lineHeight: 0.98,
		wordEffect: "pop",
		animationType: "pop",
		animationStrength: 0.9,
		animationSpeed: 1.15,
		animationSmoothness: 0.35,
		entranceAnimation: "pop",
		positionX: 50,
		positionY: 77,
		maxWidth: 90,
		targetWordsPerCaption: 3,
		maxWordsPerCaption: 4,
		minWordsPerCaption: 1,
		maxCharsPerCaption: 34,
		minCaptionDuration: 0.35,
		maxCaptionDuration: 2.2,
	},
	apple_cinematic: {
		name: "Apple Cinematic",
		description:
			"Premium center-screen word reveals with opacity, upward motion, and blur.",
		fontFamily: "Poppins",
		fontSize: 68,
		fontWeight: 600,
		textColor: "#FFFFFF",
		activeWordColor: "#FFFFFF",
		backgroundEnabled: false,
		backgroundOpacity: 0,
		lineHeight: 1.05,
		wordEffect: "fade",
		animationType: "none",
		animationStrength: 0.4,
		animationSpeed: 1,
		animationSmoothness: 1,
		entranceAnimation: "fade",
		positionX: 50,
		positionY: 50,
		maxWidth: 86,
		targetWordsPerCaption: 4,
		maxWordsPerCaption: 5,
		minWordsPerCaption: 2,
		maxCharsPerCaption: 34,
		minCaptionDuration: 0.8,
		maxCaptionDuration: 3,
	},
	kinetic_fade: {
		name: "Kinetic Fade",
		description: "Smooth word reveal with lightweight motion.",
		fontFamily: "Poppins",
		fontSize: 56,
		fontWeight: 800,
		textColor: "#FFFFFF",
		activeWordColor: "#BDE0FF",
		backgroundEnabled: false,
		backgroundOpacity: 0,
		lineHeight: 1.08,
		wordEffect: "fade",
		animationType: "none",
		animationStrength: 0.45,
		animationSpeed: 1,
		animationSmoothness: 0.85,
		entranceAnimation: "fade",
		positionX: 50,
		positionY: 76,
		maxWidth: 88,
		targetWordsPerCaption: 3,
		maxWordsPerCaption: 4,
		minWordsPerCaption: 1,
		maxCharsPerCaption: 34,
		minCaptionDuration: 0.35,
		maxCaptionDuration: 2.2,
	},
	mrbeast_style: {
		name: "MrBeast Style",
		description:
			"1-2 word all-caps captions with heavy stroke, smart colors, and mechanical pop.",
		fontFamily: "Komika Axis",
		fontSize: 76,
		fontWeight: 900,
		textColor: "#FFFFFF",
		activeWordColor: "#FFFF00",
		backgroundEnabled: false,
		backgroundOpacity: 0,
		lineHeight: 0.92,
		wordEffect: "pop",
		animationType: "pop",
		animationStrength: 1.35,
		animationSpeed: 1.4,
		animationSmoothness: 0,
		entranceAnimation: "pop",
		positionX: 50,
		positionY: 70,
		maxWidth: 92,
		targetWordsPerCaption: 2,
		maxWordsPerCaption: 2,
		minWordsPerCaption: 1,
		maxCharsPerCaption: 22,
		minCaptionDuration: 0.18,
		maxCaptionDuration: 1.2,
	},
	modern_minimalist_lockup: {
		name: "Editorial Lockup",
		description:
			"Editorial lockup captions with one anchor word and fixed reveal positions.",
		fontFamily: "Montserrat",
		fontSize: 112,
		fontWeight: 900,
		textColor: "#FFFFFF",
		activeWordColor: "#FFFFFF",
		backgroundEnabled: false,
		backgroundOpacity: 0,
		lineHeight: 0.95,
		wordEffect: "reveal",
		animationType: "none",
		animationStrength: 0,
		animationSpeed: 1,
		animationSmoothness: 0,
		entranceAnimation: "slide",
		positionX: 50,
		positionY: 50,
		maxWidth: 86,
		targetWordsPerCaption: 3,
		maxWordsPerCaption: 4,
		minWordsPerCaption: 2,
		maxCharsPerCaption: 30,
		minCaptionDuration: 0.55,
		maxCaptionDuration: 2.2,
	},
};

describe("Capinsta style foundation", () => {
	test("registers the six Capinsta caption presets", () => {
		expect(CAPINSTA_CAPTION_PRESETS.map((preset) => preset.id)).toEqual([
			"word_highlight_box",
			"attention_punch",
			"apple_cinematic",
			"kinetic_fade",
			"mrbeast_style",
			"modern_minimalist_lockup",
		]);
	});

	test("six preset values match the extracted original Capinsta registry", () => {
		for (const preset of CAPINSTA_CAPTION_PRESETS) {
			const expected = ORIGINAL_PRESET_EXPECTATIONS[preset.id];

			expect(preset.name).toBe(expected.name);
			expect(preset.description).toBe(expected.description);
			expect(preset.style.presetName).toBe(expected.name);
			expect(preset.style.text.fontFamily).toBe(expected.fontFamily);
			expect(preset.style.lockup.bigFontFamily).toBe(expected.fontFamily);
			expect(preset.style.lockup.smallFontFamily).toBe(expected.fontFamily);
			expect(preset.style.text.fontSize).toBe(expected.fontSize);
			expect(preset.style.text.fontWeight).toBe(expected.fontWeight);
			expect(preset.style.text.color).toBe(expected.textColor);
			expect(preset.style.activeWord.color).toBe(expected.activeWordColor);
			expect(preset.style.background.enabled).toBe(expected.backgroundEnabled);
			expect(preset.style.background.opacity).toBe(expected.backgroundOpacity);
			expect(preset.style.text.lineHeight).toBe(expected.lineHeight);
			expect(preset.style.animation.wordEffect).toBe(expected.wordEffect);
			expect(preset.style.animation.type).toBe(expected.animationType);
			expect(preset.style.animation.strength).toBe(expected.animationStrength);
			expect(preset.style.animation.speed).toBe(expected.animationSpeed);
			expect(preset.style.animation.smoothness).toBe(
				expected.animationSmoothness,
			);
			expect(preset.style.animation.entrance).toBe(expected.entranceAnimation);
			expect(preset.style.layout.positionX).toBe(expected.positionX);
			expect(preset.style.layout.positionY).toBe(expected.positionY);
			expect(preset.style.layout.maxWidth).toBe(expected.maxWidth);
			expect(preset.style.chunking.targetWordsPerCaption).toBe(
				expected.targetWordsPerCaption,
			);
			expect(preset.style.chunking.maxWordsPerCaption).toBe(
				expected.maxWordsPerCaption,
			);
			expect(preset.style.chunking.minWordsPerCaption).toBe(
				expected.minWordsPerCaption,
			);
			expect(preset.style.chunking.maxCharsPerCaption).toBe(
				expected.maxCharsPerCaption,
			);
			expect(preset.style.chunking.minCaptionDuration).toBe(
				expected.minCaptionDuration,
			);
			expect(preset.style.chunking.maxCaptionDuration).toBe(
				expected.maxCaptionDuration,
			);
		}
	});

	test("ports original fidelity fields that affect preset visuals", () => {
		const mrbeast = getCapinstaPresetStyle("mrbeast_style");
		expect(mrbeast.effects).toMatchObject({
			randomTiltEnabled: true,
			smartHighlightEnabled: true,
			emphasisGreenColor: "#00FF00",
			emphasisYellowColor: "#FFFF00",
			emphasisRedColor: "#FF0000",
		});

		const apple = getCapinstaPresetStyle("apple_cinematic");
		expect(apple.reveal).toMatchObject({
			duration: 0.32,
			yOffset: 30,
			blur: 25,
			phraseHoldDuration: 0.2,
		});

		const editorial = getCapinstaPresetStyle("modern_minimalist_lockup");
		expect(editorial.lockup).toMatchObject({
			bigFontSizePx: 220,
			smallFontSizePx: 104,
			anchorSizeMultiplier: 1.55,
			supportSizeMultiplier: 0.28,
			layoutMode: "auto",
			layoutAsymmetry: 0.45,
			layoutSafeMarginPercent: 8,
			collisionPadding: 8,
			tightness: 0.75,
		});
	});

	test("normalizes old captions without style metadata", () => {
		const document = capinstaTranscriptToCaptionDocument(
			sampleCapinstaTranscriptV1,
		);
		const migrated = ensureCapinstaDocumentStyles({
			...document,
			style: undefined,
			clips: document.clips.map((clip) => ({ ...clip, style: undefined })),
		});

		expect(migrated.style?.version).toBe("capinsta.captionStyle.v1");
		expect(migrated.style?.presetId).toBe("word_highlight_box");
		expect(migrated.style?.text.wordSpacing).toBe(0);
		expect(migrated.clips[0]?.style).toBeUndefined();
	});

	test("validates unsafe style values back to bounded values", () => {
		const style = normalizeCapinstaCaptionStyle({
			...getCapinstaPresetStyle("word_highlight_box"),
			text: { fontSize: 999, alignment: "sideways" },
			layout: { positionX: -100 },
		});

		expect(style.text.fontSize).toBe(220);
		expect(style.text.alignment).toBe("center");
		expect(style.layout.positionX).toBe(0);
	});

	test("applies a preset to one clip metadata record", () => {
		const baseRecord = recordForDocument();
		const clipId = baseRecord.document.clips[0]!.id;
		const record = applyCapinstaPresetToClipStyle({
			record: baseRecord,
			clipId,
			presetId: "mrbeast_style",
		});

		expect(record.document.clips[0]?.stylePresetId).toBe("mrbeast_style");
		expect(record.document.clips[0]?.styleOverrides?.activeWord?.color).toBe(
			"#FFFF00",
		);
		expect(record.document.clips[1]?.stylePresetId).toBe("word_highlight_box");
	});

	test("updates one clip style and keeps project metadata serializable", () => {
		const baseRecord = recordForDocument();
		const clipId = baseRecord.document.clips[0]!.id;
		const record = updateCapinstaClipStyle({
			record: baseRecord,
			clipId,
			patch: { text: { color: "#ff0000" } },
		});
		const project = upsertCapinstaCaptionDocument({
			project: { capinstaCaptionDocuments: [] } as TProject,
			record,
		});

		expect(
			project.capinstaCaptionDocuments?.[0]?.document.clips[0]?.styleOverrides
				?.text?.color,
		).toBe("#ff0000");
		expect(
			JSON.parse(JSON.stringify(project)).capinstaCaptionDocuments,
		).toHaveLength(1);
	});

	test("maps preview and export style from one shared style model", () => {
		const base = getCapinstaPresetStyle("attention_punch");
		const style = mergeCapinstaCaptionStyle(base, {
			text: { color: "#00ff00" },
			activeWord: { color: "#ff00ff" },
		});
		const preview = styleToPreview({ style });
		const exportStyle = styleToExport({ style });

		expect(preview.textStyle.color).toContain("0, 255, 0");
		expect(exportStyle.textParams.color).toBe("#00ff00");
		expect(exportStyle.activeWordColor).toBe("#ff00ff");
	});

	test("all presets produce safe portrait preview and export style data", () => {
		for (const preset of CAPINSTA_CAPTION_PRESETS) {
			const preview = styleToPreview({
				style: preset.style,
				viewport: { width: 360, height: 640 },
			});
			const exportStyle = styleToExport({ style: preset.style });

			expect(preview.effectiveFontSize).toBeGreaterThanOrEqual(11);
			expect(preview.effectiveFontSize).toBeLessThanOrEqual(89.6);
			expect(preview.containerStyle.width).toMatch(/%$/);
			expect(exportStyle.textParams.fontFamily).toBe(
				preset.style.text.fontFamily,
			);
			expect(exportStyle.textParams.fontSize).toBeLessThan(
				preset.style.text.fontSize,
			);
			expect(exportStyle.canvasFontSizePx).toBeGreaterThan(0);
			expect(exportStyle.maxWidthPx).toBeGreaterThan(0);
		}
	});

	test("all presets stay inside a conservative landscape preview height", () => {
		for (const preset of CAPINSTA_CAPTION_PRESETS) {
			const preview = styleToPreview({
				style: preset.style,
				viewport: { width: 1280, height: 720 },
			});

			expect(preview.effectiveFontSize).toBeLessThanOrEqual(100.8);
		}
	});

	test("maps advanced background, border, and shadow controls to preview", () => {
		const style = normalizeCapinstaCaptionStyle({
			...getCapinstaPresetStyle("word_highlight_box"),
			background: {
				enabled: true,
				fit: "fill",
				borderEnabled: true,
				borderColor: "#ff0000",
				borderWidth: 3,
				shadowEnabled: true,
				shadowColor: "#00ff00",
				shadowOpacity: 0.5,
				shadowBlur: 10,
				shadowDistance: 6,
				shadowAngle: 45,
			},
		});
		const preview = styleToPreview({ style });

		expect(preview.backgroundStyle.width).toBe("100%");
		expect(preview.backgroundStyle.border).toBe("3px solid #ff0000");
		expect(preview.backgroundStyle.boxShadow).toContain("rgba(0, 255, 0, 0.5)");
	});

	test("maps advanced text, outline, and layout controls to export params", () => {
		const style = normalizeCapinstaCaptionStyle({
			...getCapinstaPresetStyle("word_highlight_box"),
			text: {
				letterSpacing: 4,
				wordSpacing: 12,
				opacity: 0.7,
				maxLines: 1,
			},
			layout: {
				scale: 1.3,
				opacity: 0.6,
				asymmetricScaleEnabled: true,
				asymmetricScaleStrength: 0.2,
			},
			outline: {
				weight: "thick",
				width: 7,
			},
		});
		const preview = styleToPreview({ style });
		const exportStyle = styleToExport({ style });

		expect(preview.textStyle.letterSpacing).toBe("4px");
		expect(preview.textStyle.wordSpacing).toBe("12px");
		expect(preview.textStyle.WebkitLineClamp).toBe(1);
		expect(preview.textStyle.WebkitTextStroke).toBe("7px #000000");
		expect(exportStyle.textParams.letterSpacing).toBe(4);
		expect(exportStyle.textParams.wordSpacing).toBe(12);
		expect(exportStyle.textParams.opacity).toBe(0.6);
		expect(exportStyle.textParams["transform.scaleX"]).toBe(1.3);
		expect(exportStyle.textParams["transform.scaleY"]).toBeCloseTo(1.04);
	});

	test("maps word effects and transitions", () => {
		const style = normalizeCapinstaCaptionStyle({
			...getCapinstaPresetStyle("word_highlight_box"),
			animation: {
				wordEffect: "paint",
				type: "none",
				transition: "flip",
				entrance: "flip",
				strength: 1.2,
				speed: 1.8,
				smoothness: 0.25,
			},
		});

		expect(style.animation.wordEffect).toBe("paint");
		expect(style.animation.transition).toBe("flip");
		expect(style.animation.entrance).toBe("flip");
		expect(style.animation.strength).toBe(1.2);
		expect(style.animation.speed).toBe(1.8);
	});

	test("preview motion helpers keep unknown effects static", () => {
		expect(
			getCapinstaEntranceStyle({ transition: "none", progress: 0.5 }),
		).toEqual({});
		expect(
			getCapinstaActiveWordEffectStyle({
				effect: "none",
				strength: 1,
				timeSeconds: 1,
				wordStart: 0,
				activeStyle: { color: "#ffff00" },
			}),
		).toEqual({});
	});

	test("preview motion helpers expose deterministic pop and paint styles", () => {
		expect(
			getCapinstaEntranceStyle({ transition: "pop", progress: 0.5 }).transform,
		).toBe("scale(0.9888888888888889)");
		expect(
			getCapinstaActiveWordEffectStyle({
				effect: "paint",
				strength: 1,
				timeSeconds: 0.2,
				wordStart: 0,
				activeStyle: { color: "#fde047" },
			}).backgroundSize,
		).toBe("78% 0.18em");
	});

	test("reset-to-preset behavior restores preset defaults without changing caption text", () => {
		const baseRecord = recordForDocument();
		const clipId = baseRecord.document.clips[0]!.id;
		const editedRecord = updateCapinstaClipStyle({
			record: applyCapinstaPresetToClipStyle({
				record: baseRecord,
				clipId,
				presetId: "mrbeast_style",
			}),
			clipId,
			patch: { text: { color: "#123456" } },
		});
		const resetRecord = applyCapinstaPresetToClipStyle({
			record: editedRecord,
			clipId,
			presetId: "mrbeast_style",
		});

		expect(resetRecord.document.clips[0]?.text).toBe("Build the edit then");
		expect(
			resolveCapinstaClipStyle({
				document: resetRecord.document,
				clip: resetRecord.document.clips[0]!,
			}).text.color,
		).toBe("#FFFFFF");
		expect(resetRecord.document.clips[0]?.styleOverrides?.presetId).toBe("mrbeast_style");
	});

	test("word-effect none exports static styled captions", () => {
		const style = styleToExport({
			style: normalizeCapinstaCaptionStyle({
				...getCapinstaPresetStyle("word_highlight_box"),
				animation: { wordEffect: "none" },
			}),
		});

		expect(style.useActiveWordHighlight).toBe(false);
	});

	test("oversized preview captions are clamped to the video height", () => {
		const style = normalizeCapinstaCaptionStyle({
			...getCapinstaPresetStyle("modern_minimalist_lockup"),
			text: { fontSize: 180, maxLines: 2 },
		});
		const preview = styleToPreview({
			style,
			viewport: { width: 180, height: 320 },
		});

		expect(preview.effectiveFontSize).toBeLessThanOrEqual(44.8);
		expect(preview.textStyle.overflowWrap).toBe("anywhere");
	});

	test("maxWidth and maxLines are respected by preview mapping", () => {
		const style = normalizeCapinstaCaptionStyle({
			...getCapinstaPresetStyle("word_highlight_box"),
			text: { maxLines: 1 },
			layout: { maxWidth: 64 },
		});
		const preview = styleToPreview({
			style,
			viewport: { width: 640, height: 360 },
		});

		expect(preview.containerStyle.width).toBe("64%");
		expect(preview.textStyle.WebkitLineClamp).toBe(1);
	});

	test("preview renderer excludes debug metadata and marks the active word", () => {
		const document = capinstaTranscriptToCaptionDocument(
			sampleCapinstaTranscriptV1,
		);
		const clip = document.clips[0]!;
		const markup = renderToStaticMarkup(
			createElement(CapinstaCaptionRenderer, {
				document,
				clip,
				activeWordIds: ["word-001"],
				timeSeconds: 0.42,
				viewport: { width: 360, height: 640 },
			}),
		);

		expect(markup).toContain("Build");
		expect(markup).toContain("#FFD43B");
		expect(markup).not.toContain("caption=");
		expect(markup).not.toContain("word=none");
	});

	test("keeps active-word export available when timing needs review", () => {
		const style = styleToExport({
			style: getCapinstaPresetStyle("word_highlight_box"),
			timingNeedsReview: true,
		});

		expect(style.useActiveWordHighlight).toBe(true);
	});
});
