import type {
	CreateTimelineElement,
	ElementRef,
	SceneTracks,
	TimelineTrack,
} from "@/timeline";
import type { MediaAsset } from "@/media/types";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { generateUUID } from "@/utils/id";
import type { MediaTime } from "@/wasm";

function allTracks({ tracks }: { tracks: SceneTracks }): TimelineTrack[] {
	return [...tracks.overlay, tracks.main, ...tracks.audio];
}

function refKey({ trackId, elementId }: ElementRef): string {
	return `${trackId}:${elementId}`;
}

function elementGroupIds({
	tracks,
	elementRefs,
}: {
	tracks: SceneTracks;
	elementRefs: readonly ElementRef[];
}): { linkedMediaGroupIds: Set<string>; capinstaDocumentIds: Set<string> } {
	const trackList = allTracks({ tracks });
	const linkedMediaGroupIds = new Set<string>();
	const capinstaDocumentIds = new Set<string>();

	for (const elementRef of elementRefs) {
		const track = trackList.find((item) => item.id === elementRef.trackId);
		const element = track?.elements.find(
			(item) => item.id === elementRef.elementId,
		);
		if (element?.linkedMediaGroupId) {
			linkedMediaGroupIds.add(element.linkedMediaGroupId);
		}
		if (element?.capinstaDocumentId) {
			capinstaDocumentIds.add(element.capinstaDocumentId);
		}
	}

	return { linkedMediaGroupIds, capinstaDocumentIds };
}

export function expandElementRefsWithLinkedMedia({
	tracks,
	elementRefs,
	includeCapinstaDocuments = true,
}: {
	tracks: SceneTracks;
	elementRefs: readonly ElementRef[];
	includeCapinstaDocuments?: boolean;
}): ElementRef[] {
	const trackList = allTracks({ tracks });
	const selectedKeys = new Set(elementRefs.map(refKey));
	const { linkedMediaGroupIds, capinstaDocumentIds } = elementGroupIds({
		tracks,
		elementRefs,
	});

	if (linkedMediaGroupIds.size === 0 && capinstaDocumentIds.size === 0) {
		return [...elementRefs];
	}

	const expandedRefs = [...elementRefs];
	for (const track of trackList) {
		for (const element of track.elements) {
			const matchesLinkedMedia =
				element.linkedMediaGroupId &&
				linkedMediaGroupIds.has(element.linkedMediaGroupId);
			const matchesCapinstaDocument =
				element.capinstaDocumentId &&
				includeCapinstaDocuments &&
				capinstaDocumentIds.has(element.capinstaDocumentId);
			if (!matchesLinkedMedia && !matchesCapinstaDocument) continue;

			const linkedRef = { trackId: track.id, elementId: element.id };
			const key = refKey(linkedRef);
			if (selectedKeys.has(key)) continue;

			selectedKeys.add(key);
			expandedRefs.push(linkedRef);
		}
	}

	return expandedRefs;
}

export function withLinkedMediaMetadata<
	TElement extends {
		linkedMediaGroupId?: string;
		linkedTrackRole?: "video" | "audio";
		sourceAssetId?: string;
	},
>({
	element,
	groupId,
	role,
	sourceAssetId,
}: {
	element: TElement;
	groupId: string;
	role: "video" | "audio";
	sourceAssetId: string;
}): TElement {
	return {
		...element,
		linkedMediaGroupId: groupId,
		linkedTrackRole: role,
		sourceAssetId,
	};
}

export function buildLinkedVideoAudioElements({
	mediaAsset,
	startTime,
	duration,
}: {
	mediaAsset: MediaAsset;
	startTime: MediaTime;
	duration: MediaTime;
}): {
	videoElement: CreateTimelineElement;
	audioElement: CreateTimelineElement;
} {
	const linkedMediaGroupId = generateUUID();
	const videoElement = buildElementFromMedia({
		mediaId: mediaAsset.id,
		mediaType: "video",
		name: mediaAsset.name,
		duration,
		startTime,
	});
	if (videoElement.type !== "video") {
		throw new Error("Expected a video element for linked media insertion");
	}

	return {
		videoElement: withLinkedMediaMetadata({
			element: { ...videoElement, isSourceAudioEnabled: false },
			groupId: linkedMediaGroupId,
			role: "video",
			sourceAssetId: mediaAsset.id,
		}),
		audioElement: withLinkedMediaMetadata({
			element: buildElementFromMedia({
				mediaId: mediaAsset.id,
				mediaType: "audio",
				name: mediaAsset.name,
				duration,
				startTime,
			}),
			groupId: linkedMediaGroupId,
			role: "audio",
			sourceAssetId: mediaAsset.id,
		}),
	};
}
