import type { EditorCore } from "@/core";
import {
	AddTrackCommand,
	BatchCommand,
	InsertElementCommand,
} from "@/commands";
import { buildSubtitleTextElement } from "./build-subtitle-text-element";
import type { SubtitleCue } from "./types";
import type { NeutralCaptionDocument } from "@/capinsta/types";

export function insertCaptionChunksAsTextTrack({
	editor,
	captions,
	capinstaDocument,
}: {
	editor: EditorCore;
	captions: SubtitleCue[];
	capinstaDocument?: NeutralCaptionDocument;
}): string | null {
	if (captions.length === 0) {
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
					capinsta: capinstaDocument?.clips[index]
						? {
								documentId: capinstaDocument.id,
								clipId: capinstaDocument.clips[index].id,
							}
						: undefined,
				}),
			}),
	);
	editor.command.execute({
		command: new BatchCommand([addTrackCommand, ...insertCommands]),
	});

	return trackId;
}
