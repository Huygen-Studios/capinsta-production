import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import type { CapinstaCaptionDocumentRecord } from "@/capinsta/types";
import { applyDocumentToTracks } from "@/capinsta/captionDocumentTimeline";
import type { SceneTracks } from "@/timeline";

export class UpdateCapinstaCaptionDocumentCommand extends Command {
	private beforeRecords: CapinstaCaptionDocumentRecord[] | null = null;
	private beforeTracks: SceneTracks | null = null;

	constructor(private record: CapinstaCaptionDocumentRecord) {
		super();
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.beforeRecords = editor.project.getActive().capinstaCaptionDocuments ?? [];
		this.beforeTracks = editor.scenes.getActiveScene().tracks;
		const records = [
			...this.beforeRecords.filter(
				(candidate) => candidate.document.id !== this.record.document.id,
			),
			this.record,
		];
		editor.timeline.updateTracks(
			applyDocumentToTracks({ record: this.record, tracks: this.beforeTracks }),
		);
		editor.project.replaceCapinstaCaptionDocuments({ records });
		return undefined;
	}

	undo(): void {
		if (!this.beforeRecords || !this.beforeTracks) return;
		const editor = EditorCore.getInstance();
		editor.timeline.updateTracks(this.beforeTracks);
		editor.project.replaceCapinstaCaptionDocuments({
			records: this.beforeRecords,
		});
	}
}
