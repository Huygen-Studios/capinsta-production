import { findTemplateDefinition } from "@/templates";
import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV33ToV34({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	if (!getProjectId({ project })) {
		return { project, skipped: true, reason: "no project id" };
	}
	if (project.version !== 33) {
		return { project, skipped: true, reason: "not v33" };
	}
	return {
		project: {
			...project,
			version: 34,
			...(Array.isArray(project.scenes)
				? { scenes: project.scenes.map((scene) => migrateScene({ scene })) }
				: {}),
		},
		skipped: false,
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
		element.type !== "motion-template" ||
		typeof element.templateId !== "string"
	) {
		return element;
	}
	const definition = findTemplateDefinition({ templateId: element.templateId });
	if (!definition) return element;
	const sourceVersion =
		typeof element.templateVersion === "number" &&
		Number.isFinite(element.templateVersion)
			? element.templateVersion
			: 0;
	if (sourceVersion >= 2) return element;
	const templateParams = isRecord(element.templateParams)
		? element.templateParams
		: {};
	return {
		...element,
		templateVersion: definition.version,
		templateParams: {
			...templateParams,
			frameRatio: "project",
			backgroundEnabled: false,
		},
	};
}
