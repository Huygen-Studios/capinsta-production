import { PAPER_FOLD_DEFAULTS } from "@/effects/paper-fold/types";
import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV34ToV35({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	if (!getProjectId({ project }))
		return { project, skipped: true, reason: "no project id" };
	if (project.version !== 34)
		return { project, skipped: true, reason: "not v34" };
	return {
		project: {
			...project,
			version: 35,
			...(Array.isArray(project.scenes)
				? { scenes: project.scenes.map(migrateScene) }
				: {}),
		},
		skipped: false,
	};
}

function migrateScene(scene: unknown): unknown {
	if (!isRecord(scene) || !isRecord(scene.tracks)) return scene;
	return {
		...scene,
		tracks: Object.fromEntries(
			Object.entries(scene.tracks).map(([key, value]) => [
				key,
				Array.isArray(value) ? value.map(migrateTrack) : migrateTrack(value),
			]),
		),
	};
}

function migrateTrack(track: unknown): unknown {
	if (!isRecord(track) || !Array.isArray(track.elements)) return track;
	return { ...track, elements: track.elements.map(migrateElement) };
}

function migrateElement(element: unknown): unknown {
	if (!isRecord(element)) return element;
	const migrated = { ...element };
	if (element.type === "effect" && element.effectType === "paper-fold") {
		migrated.params = normalizeStoredParams(element.params);
	}
	if (Array.isArray(element.effects)) {
		migrated.effects = element.effects.map((effect) => {
			if (!isRecord(effect) || effect.type !== "paper-fold") return effect;
			return { ...effect, params: normalizeStoredParams(effect.params) };
		});
	}
	return migrated;
}

function normalizeStoredParams(value: unknown): Record<string, unknown> {
	return {
		...PAPER_FOLD_DEFAULTS,
		...(isRecord(value) ? value : {}),
		schemaVersion: PAPER_FOLD_DEFAULTS.schemaVersion,
	};
}
