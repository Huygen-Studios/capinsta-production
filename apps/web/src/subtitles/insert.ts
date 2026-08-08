import type { EditorCore } from "@/core";
import {
	AddCapinstaCaptionDocumentCommand,
	AddTrackCommand,
	BatchCommand,
	InsertElementCommand,
} from "@/commands";
import { buildSubtitleTextElement } from "./build-subtitle-text-element";
import type { SubtitleCue } from "./types";
import type {
	CapinstaCaptionDocumentRecord,
	NeutralCaptionDocument,
} from "@/capinsta/types";

export function insertCaptionDocumentAsTextTrack({
	editor,
	captions,
	document,
	importedAt = new Date().toISOString(),
}: {
	editor: EditorCore;
	captions: SubtitleCue[];
	document: NeutralCaptionDocument;
	importedAt?: string;
}): CapinstaCaptionDocumentRecord | null {
	if (captions.length === 0 || captions.length !== document.clips.length) {
		return null;
	}

	const addTrackCommand = new AddTrackCommand({ type: "text", index: 0 });
	const trackId = addTrackCommand.getTrackId();
	const canvasSize = editor.project.getActive().settings.canvasSize;
	const insertCommands = captions.map(
		(caption, index) =>
			new InsertElementCommand({
				placement: { mode: "explicit", trackId },
				element: buildSubtitleTextElement({
					index,
					caption,
					canvasSize,
					capinsta: {
						documentId: document.id,
						clipId: document.clips[index]!.id,
					},
				}),
			}),
	);
	const record: CapinstaCaptionDocumentRecord = {
		document,
		openCutTrackId: trackId,
		importedAt,
	};
	const selection = insertCommands.map((command) => ({
		trackId,
		elementId: command.getElementId(),
	}));
	editor.command.execute({
		command: new BatchCommand([
			addTrackCommand,
			...insertCommands,
			new AddCapinstaCaptionDocumentCommand({ record, selection }),
		]),
	});
	return record;
}
