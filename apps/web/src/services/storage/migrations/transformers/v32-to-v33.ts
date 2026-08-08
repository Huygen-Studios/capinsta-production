import { normalizeLayer3DEffect } from "@/layer-3d";
import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV32ToV33({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	if (!getProjectId({ project }))
		return { project, skipped: true, reason: "no project id" };
	if (project.version !== 32)
		return { project, skipped: true, reason: "not v32" };
	return {
		project: { ...migrateProject({ project }), version: 33 },
		skipped: false,
	};
}

function migrateProject({
	project,
}: {
	project: ProjectRecord;
}): ProjectRecord {
	return {
		...project,
		...(Array.isArray(project.scenes)
			? { scenes: project.scenes.map((scene) => migrateScene({ scene })) }
			: {}),
	};
}

function migrateScene({ scene }: { scene: unknown }): unknown {
	if (!isRecord(scene) || !isRecord(scene.tracks)) return scene;
	const tracks = scene.tracks;
	return {
		...scene,
		tracks: {
			...tracks,
			...(isRecord(tracks.main)
				? { main: migrateTrack({ track: tracks.main }) }
				: {}),
			...(Array.isArray(tracks.overlay)
				? { overlay: tracks.overlay.map((track) => migrateTrack({ track })) }
				: {}),
		},
	};
}

function migrateTrack({ track }: { track: unknown }): unknown {
	if (!isRecord(track) || !Array.isArray(track.elements)) return track;
	return {
		...track,
		elements: track.elements.map((element) => migrateElement({ element })),
	};
}

function migrateElement({ element }: { element: unknown }): unknown {
	if (
		!isRecord(element) ||
		!["video", "image", "graphic"].includes(String(element.type))
	)
		return element;
	if (!("layer3DEffect" in element)) return element;
	const normalized = normalizeLayer3DEffect({ value: element.layer3DEffect });
	if (!normalized) {
		const { layer3DEffect: _invalid, ...rest } = element;
		return rest;
	}
	return { ...element, layer3DEffect: normalized };
}
