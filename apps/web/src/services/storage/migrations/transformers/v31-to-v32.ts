import { normalizeMotionTemplateElementRecord } from "@/templates/normalize";
import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV31ToV32({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	if (!getProjectId({ project })) {
		return { project, skipped: true, reason: "no project id" };
	}

	const version = project.version;
	if (typeof version !== "number") {
		return { project, skipped: true, reason: "invalid version" };
	}
	if (version >= 32) {
		return { project, skipped: true, reason: "already v32" };
	}
	if (version !== 31) {
		return { project, skipped: true, reason: "not v31" };
	}

	return {
		project: {
			...migrateProject({ project }),
			version: 32,
		},
		skipped: false,
	};
}

function migrateProject({
	project,
}: {
	project: ProjectRecord;
}): ProjectRecord {
	const nextProject = { ...project };
	if (Array.isArray(project.scenes)) {
		nextProject.scenes = project.scenes.map((scene) => migrateScene({ scene }));
	}
	return nextProject;
}

function migrateScene({ scene }: { scene: unknown }): unknown {
	if (!isRecord(scene)) return scene;
	const nextScene = { ...scene };
	if (isRecord(scene.tracks)) {
		nextScene.tracks = migrateTracks({ tracks: scene.tracks });
	}
	return nextScene;
}

function migrateTracks({ tracks }: { tracks: ProjectRecord }): ProjectRecord {
	const nextTracks = { ...tracks };
	if (isRecord(tracks.main)) {
		nextTracks.main = migrateTrack({ track: tracks.main });
	}
	if (Array.isArray(tracks.overlay)) {
		nextTracks.overlay = tracks.overlay.map((track) => migrateTrack({ track }));
	}
	if (Array.isArray(tracks.audio)) {
		nextTracks.audio = tracks.audio.map((track) => migrateTrack({ track }));
	}
	return nextTracks;
}

function migrateTrack({ track }: { track: unknown }): unknown {
	if (!isRecord(track) || !Array.isArray(track.elements)) return track;
	return {
		...track,
		elements: track.elements.map((element) => migrateElement({ element })),
	};
}

function migrateElement({ element }: { element: unknown }): unknown {
	if (!isRecord(element) || element.type !== "motion-template") return element;
	return normalizeMotionTemplateElementRecord({ element });
}
