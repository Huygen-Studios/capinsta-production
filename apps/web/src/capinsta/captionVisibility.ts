import type { CapinstaCaptionDocumentRecord } from "./types";
import type { SceneTracks } from "@/timeline";

export function isCapinstaCaptionRecordVisible({
	record,
	tracks,
}: {
	record: CapinstaCaptionDocumentRecord;
	tracks: SceneTracks;
}): boolean {
	const track = tracks.overlay.find(
		(candidate) => candidate.id === record.openCutTrackId,
	);
	return track?.hidden !== true;
}

export function getVisibleCapinstaCaptionRecords({
	records,
	tracks,
	includeHidden = false,
}: {
	records: CapinstaCaptionDocumentRecord[];
	tracks: SceneTracks;
	includeHidden?: boolean;
}): CapinstaCaptionDocumentRecord[] {
	if (includeHidden) return records;
	return records.filter((record) =>
		isCapinstaCaptionRecordVisible({ record, tracks }),
	);
}
