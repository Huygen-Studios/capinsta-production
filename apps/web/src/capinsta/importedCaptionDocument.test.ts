import { describe, expect, test } from "bun:test";
import { parseSrt } from "@/subtitles/srt";
import { buildSubtitleTextElement } from "@/subtitles/build-subtitle-text-element";
import { importedSubtitleCuesToCaptionDocument } from "./importedCaptionDocument";
import { upsertCapinstaCaptionDocument } from "./projectMetadata";

const SRT = `1
00:00:00,125 --> 00:00:01,875
Hello,
world!

2
00:00:02,010 --> 00:00:04,345
नमस्ते दुनिया`;

describe("imported subtitle caption documents", () => {
	test("preserves SRT cue timing, multiline text, Unicode, and clip associations", () => {
		const parsed = parseSrt({ input: SRT });
		const document = importedSubtitleCuesToCaptionDocument({
			captions: parsed.captions,
			sourceName: "captions.srt",
			documentId: "capinsta-doc-import-test",
			importedAt: "2026-07-23T00:00:00.000Z",
		});

		expect(document.sourceTranscriptRef.provider).toBe("subtitle_import");
		expect(document.timing.sourceOfTruth).toBe("clips");
		expect(document.clips).toHaveLength(2);
		expect(document.clips[0]).toEqual(
			expect.objectContaining({
				start: 0.125,
				end: 1.875,
				text: "Hello,\nworld!",
				timingSource: "estimated",
				disableActiveWordHighlighting: true,
			}),
		);
		expect(document.clips[1]?.text).toBe("नमस्ते दुनिया");
		expect(
			document.words.every((word) => word.timingSource === "estimated"),
		).toBe(true);
		for (const clip of document.clips) {
			const words = document.words.filter((word) =>
				clip.wordIds.includes(word.id),
			);
			expect(words[0]?.start).toBe(clip.start);
			expect(words.at(-1)?.end).toBe(clip.end);
			expect(
				words.every((word) => word.start >= clip.start && word.end <= clip.end),
			).toBe(true);
		}
	});

	test("adds document and clip metadata to every imported timeline element", () => {
		const parsed = parseSrt({ input: SRT });
		const document = importedSubtitleCuesToCaptionDocument({
			captions: parsed.captions,
			sourceName: "captions.srt",
			documentId: "capinsta-doc-import-bindings",
		});

		const previousDocument = globalThis.document;
		Object.assign(globalThis, {
			document: {
				createElement: () => ({
					width: 0,
					height: 0,
					getContext: () => null,
				}),
			},
		});
		const elements = parsed.captions.map((caption, index) =>
			buildSubtitleTextElement({
				index,
				caption,
				canvasSize: { width: 1920, height: 1080 },
				capinsta: {
					documentId: document.id,
					clipId: document.clips[index]!.id,
				},
			}),
		);
		Object.assign(globalThis, { document: previousDocument });

		expect(
			elements.map((element) => ({
				documentId: element.capinstaDocumentId,
				clipId: element.capinstaClipId,
			})),
		).toEqual(
			document.clips.map((clip) => ({
				documentId: document.id,
				clipId: clip.id,
			})),
		);
	});

	test("survives project JSON serialization with editable imported metadata", () => {
		const parsed = parseSrt({ input: SRT });
		const document = importedSubtitleCuesToCaptionDocument({
			captions: parsed.captions,
			sourceName: "captions.srt",
			documentId: "capinsta-doc-import-persistence",
		});
		const project = upsertCapinstaCaptionDocument({
			project: {
				capinstaCaptionDocuments: [],
			},
			record: {
				document,
				openCutTrackId: "text-track-imported",
				importedAt: "2026-07-23T00:00:00.000Z",
			},
		});
		const restored = JSON.parse(JSON.stringify(project));

		expect(restored.capinstaCaptionDocuments[0].document.id).toBe(document.id);
		expect(restored.capinstaCaptionDocuments[0].openCutTrackId).toBe(
			"text-track-imported",
		);
		expect(
			restored.capinstaCaptionDocuments[0].document.clips[1].editable,
		).toBe(true);
	});
});
