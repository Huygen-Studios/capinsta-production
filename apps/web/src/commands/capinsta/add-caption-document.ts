import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import type { CapinstaCaptionDocumentRecord } from "@/capinsta/types";
import {
	forgetCapinstaCaptionDocument,
	getCapinstaCaptionDocument,
	rememberCapinstaCaptionDocumentRecord,
} from "@/capinsta/captionDocumentRegistry";
import type { ElementRef } from "@/timeline/types";

export class AddCapinstaCaptionDocumentCommand extends Command {
	private beforeRecords: CapinstaCaptionDocumentRecord[] | null = null;
	private beforeRegistryRecord: CapinstaCaptionDocumentRecord | undefined;

	constructor({
		record,
		selection = [],
	}: {
		record: CapinstaCaptionDocumentRecord;
		selection?: ElementRef[];
	}) {
		super();
		this.record = record;
		this.selection = selection;
	}

	private record: CapinstaCaptionDocumentRecord;
	private selection: ElementRef[];

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.beforeRecords =
			editor.project.getActive().capinstaCaptionDocuments ?? [];
		this.beforeRegistryRecord = getCapinstaCaptionDocument({
			documentId: this.record.document.id,
		});
		rememberCapinstaCaptionDocumentRecord(this.record);
		editor.project.addCapinstaCaptionDocument({ record: this.record });
		return this.selection.length > 0
			? {
					selection: {
						selectedElements: this.selection,
						elementSelectionMode: "group",
						primarySelectedElement: this.selection[0] ?? null,
						selectedKeyframes: [],
						keyframeSelectionAnchor: null,
						selectedMaskPoints: null,
					},
				}
			: undefined;
	}

	undo(): void {
		if (!this.beforeRecords) return;
		const editor = EditorCore.getInstance();
		editor.project.replaceCapinstaCaptionDocuments({
			records: this.beforeRecords,
		});
		if (this.beforeRegistryRecord) {
			rememberCapinstaCaptionDocumentRecord(this.beforeRegistryRecord);
		} else {
			forgetCapinstaCaptionDocument({
				documentId: this.record.document.id,
			});
		}
	}
}
