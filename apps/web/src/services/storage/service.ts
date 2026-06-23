import type { TProject, TProjectMetadata } from "@/project/types";
import { getProjectDurationFromScenes } from "@/timeline/scenes";
import type { MediaAsset } from "@/media/types";
import { IndexedDBAdapter } from "./indexeddb-adapter";
import { IndexedDBFileAdapter } from "./indexeddb-file-adapter";
import { OPFSAdapter } from "./opfs-adapter";
import {
	type StorageCapacityCheckResult,
	StorageQuotaExceededError,
	evaluateStorageCapacity,
	isStorageQuotaExceededError,
	readStorageQuotaStatus,
} from "./quota";
import type {
	LegacyBrowserStorageRecoveryResult,
	MediaAssetData,
	StorageConfig,
	SerializedProject,
	SerializedScene,
} from "./types";
import {
	migrations,
	runStorageMigrations,
} from "@/services/storage/migrations";
import type { Bookmark, SceneTracks, TScene } from "@/timeline";
import { roundMediaTime } from "@/wasm";
import {
	fetchProjectMediaAsset,
	verifyProjectMediaAsset,
} from "@/capinsta/mediaAssetApi";
import { browserCacheRegistry } from "./browser-cache-registry";

function normalizeBookmarks({ raw }: { raw: unknown }): Bookmark[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map((item): Bookmark | null => {
			if (typeof item === "number") {
				return { time: roundMediaTime({ time: item }) };
			}
			if (!isRecord(item) || typeof item.time !== "number") {
				return null;
			}
			return {
				time: roundMediaTime({ time: item.time }),
				...(typeof item.note === "string" && { note: item.note }),
				...(typeof item.color === "string" && { color: item.color }),
				...(typeof item.duration === "number" && {
					duration: roundMediaTime({ time: item.duration }),
				}),
			};
		})
		.filter((b): b is Bookmark => b !== null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function shouldPersistMediaFileInBrowser({
	serverAssetId,
}: {
	serverAssetId?: string;
}): boolean {
	return !serverAssetId;
}

class StorageService {
	private projectsAdapter: IndexedDBAdapter<SerializedProject>;
	private config: StorageConfig;
	private migrationsPromise: Promise<void> | null = null;

	constructor() {
		this.config = {
			projectsDb: "video-editor-projects",
			mediaDb: "video-editor-media",
			version: 1,
		};

		this.projectsAdapter = new IndexedDBAdapter<SerializedProject>({
			dbName: this.config.projectsDb,
			storeName: "projects",
			version: this.config.version,
		});
	}

	setUserScope({ userId }: { userId: string }): void {
		const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, "");
		const projectsDb = `video-editor-projects-${safeUserId}`;
		if (this.config.projectsDb === projectsDb) return;
		this.config = {
			...this.config,
			projectsDb,
			mediaDb: `video-editor-media-${safeUserId}`,
		};
		this.projectsAdapter = new IndexedDBAdapter<SerializedProject>({
			dbName: this.config.projectsDb,
			storeName: "projects",
			version: this.config.version,
		});
		this.migrationsPromise = null;
	}

	private async ensureMigrations(): Promise<void> {
		if (this.migrationsPromise) {
			await this.migrationsPromise;
			return;
		}

		this.migrationsPromise = runStorageMigrations({ migrations }).then(
			() => undefined,
		);
		await this.migrationsPromise;
	}

	private getProjectMediaAdapters({ projectId }: { projectId: string }) {
		const mediaMetadataAdapter = new IndexedDBAdapter<MediaAssetData>({
			dbName: `${this.config.mediaDb}-${projectId}`,
			storeName: "media-metadata",
			version: this.config.version,
		});

		let mediaAssetsAdapter;
		if (OPFSAdapter.isSupported()) {
			mediaAssetsAdapter = new OPFSAdapter(`media-files-${projectId}`);
		} else {
			console.warn("OPFS unavailable; using IndexedDB media storage fallback.");
			mediaAssetsAdapter = new IndexedDBFileAdapter({
				dbName: `${this.config.mediaDb}-${projectId}-files`,
				storeName: "media-files",
				version: this.config.version,
			});
		}

		return { mediaMetadataAdapter, mediaAssetsAdapter };
	}

	async canStoreFile({
		size,
	}: {
		size: number;
	}): Promise<StorageCapacityCheckResult> {
		const quotaStatus = await readStorageQuotaStatus();
		return evaluateStorageCapacity({
			requiredBytes: size,
			quotaStatus,
		});
	}

	isQuotaExceededError({ error }: { error: unknown }): boolean {
		return isStorageQuotaExceededError({ error });
	}
	private stripAudioBuffers({ tracks }: { tracks: SceneTracks }): SceneTracks {
		return {
			...tracks,
			audio: tracks.audio.map((track) => ({
				...track,
				elements: track.elements.map((element) => {
					const { buffer: _buffer, ...rest } = element;
					return rest;
				}),
			})),
		};
	}

	async saveProject({ project }: { project: TProject }): Promise<void> {
		const duration =
			project.metadata.duration ??
			getProjectDurationFromScenes({ scenes: project.scenes });
		const serializedScenes: SerializedScene[] = project.scenes.map((scene) => ({
			id: scene.id,
			name: scene.name,
			isMain: scene.isMain,
			tracks: this.stripAudioBuffers({ tracks: scene.tracks }),
			bookmarks: scene.bookmarks,
			createdAt: scene.createdAt.toISOString(),
			updatedAt: scene.updatedAt.toISOString(),
		}));

		const serializedProject: SerializedProject = {
			metadata: {
				id: project.metadata.id,
				name: project.metadata.name,
				thumbnail: project.metadata.thumbnail,
				duration,
				createdAt: project.metadata.createdAt.toISOString(),
				updatedAt: project.metadata.updatedAt.toISOString(),
			},
			scenes: serializedScenes,
			currentSceneId: project.currentSceneId,
			settings: project.settings,
			version: project.version,
			timelineViewState: project.timelineViewState,
			capinstaCaptionDocuments: project.capinstaCaptionDocuments,
			capinstaServerJobId: project.capinstaServerJobId,
			capinstaLeftAt: project.capinstaLeftAt,
		};

		await this.projectsAdapter.set({
			key: project.metadata.id,
			value: serializedProject,
		});
		await browserCacheRegistry.register({
			id: `project:${project.metadata.id}`,
			projectId: project.metadata.id,
			assetType: "project_snapshot",
			estimatedByteSize: new TextEncoder().encode(
				JSON.stringify(serializedProject),
			).byteLength,
			evictable: false,
		});
	}

	async loadProject({
		id,
	}: {
		id: string;
	}): Promise<{ project: TProject } | null> {
		await this.ensureMigrations();
		const serializedProject = await this.projectsAdapter.get(id);

		if (!serializedProject) return null;
		await browserCacheRegistry.touch(`project:${id}`);

		if (
			typeof serializedProject !== "object" ||
			serializedProject === null ||
			typeof serializedProject.metadata !== "object" ||
			serializedProject.metadata === null
		) {
			console.warn(
				"[storage] Skipping malformed project entry (missing metadata):",
				{ id, entry: serializedProject },
			);
			return null;
		}

		const scenes =
			serializedProject.scenes?.map((scene) => ({
				id: scene.id,
				name: scene.name,
				isMain: scene.isMain,
				tracks: scene.tracks,
				bookmarks: normalizeBookmarks({ raw: scene.bookmarks }),
				createdAt: new Date(scene.createdAt),
				updatedAt: new Date(scene.updatedAt),
			})) ?? [];

		const project: TProject = {
			metadata: {
				id: serializedProject.metadata.id,
				name: serializedProject.metadata.name,
				thumbnail: serializedProject.metadata.thumbnail,
				duration: roundMediaTime({
					time:
						serializedProject.metadata.duration ??
						getProjectDurationFromScenes({ scenes }),
				}),
				createdAt: new Date(serializedProject.metadata.createdAt),
				updatedAt: new Date(serializedProject.metadata.updatedAt),
			},
			scenes,
			currentSceneId: serializedProject.currentSceneId || "",
			settings: serializedProject.settings,
			version: serializedProject.version,
			timelineViewState: serializedProject.timelineViewState,
			capinstaCaptionDocuments: serializedProject.capinstaCaptionDocuments,
			capinstaServerJobId: serializedProject.capinstaServerJobId,
			capinstaLeftAt: serializedProject.capinstaLeftAt,
		};

		return { project };
	}

	async loadAllProjects(): Promise<TProject[]> {
		const projectIds = await this.projectsAdapter.list();
		const projects: TProject[] = [];

		for (const id of projectIds) {
			const result = await this.loadProject({ id });
			if (result?.project) {
				projects.push(result.project);
			}
		}

		return projects.sort(
			(a, b) => b.metadata.updatedAt.getTime() - a.metadata.updatedAt.getTime(),
		);
	}

	async loadAllProjectsMetadata(): Promise<TProjectMetadata[]> {
		await this.ensureMigrations();
		const serializedProjects = await this.projectsAdapter.getAll();

		const metadata: TProjectMetadata[] = [];
		for (const serializedProject of serializedProjects) {
			if (
				typeof serializedProject !== "object" ||
				serializedProject === null ||
				typeof serializedProject.metadata !== "object" ||
				serializedProject.metadata === null
			) {
				console.warn(
					"[storage] Skipping malformed project entry (missing metadata):",
					serializedProject,
				);
				continue;
			}

			metadata.push({
				id: serializedProject.metadata.id,
				name: serializedProject.metadata.name,
				thumbnail: serializedProject.metadata.thumbnail,
				duration: roundMediaTime({
					time:
						serializedProject.metadata.duration ??
						getProjectDurationFromScenes({
							scenes: restoreSerializedScenesForDuration({
								scenes: serializedProject.scenes ?? [],
							}),
						}),
				}),
				createdAt: new Date(serializedProject.metadata.createdAt),
				updatedAt: new Date(serializedProject.metadata.updatedAt),
			});
		}
		await browserCacheRegistry.cleanupOrphans(
			new Set(metadata.map((project) => project.id)),
		);

		return metadata.sort(
			(a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
		);
	}

	async deleteProject({ id }: { id: string }): Promise<void> {
		await this.projectsAdapter.remove(id);
		await browserCacheRegistry.deleteProject(id);
	}

	async saveMediaAsset({
		projectId,
		mediaAsset,
	}: {
		projectId: string;
		mediaAsset: MediaAsset;
	}): Promise<void> {
		const { mediaMetadataAdapter, mediaAssetsAdapter } =
			this.getProjectMediaAdapters({ projectId });

		const metadata: MediaAssetData = {
			id: mediaAsset.id,
			name: mediaAsset.name,
			type: mediaAsset.type,
			mimeType: mediaAsset.file.type,
			size: mediaAsset.file.size,
			lastModified: mediaAsset.file.lastModified,
			width: mediaAsset.width,
			height: mediaAsset.height,
			duration: mediaAsset.duration,
			fps: mediaAsset.fps,
			hasAudio: mediaAsset.hasAudio,
			extractedAudioAssetId: mediaAsset.extractedAudioAssetId,
			audioExtractionStatus: mediaAsset.audioExtractionStatus,
			sourceMediaHash: mediaAsset.sourceMediaHash,
			sourceAssetId: mediaAsset.sourceAssetId,
			thumbnailUrl: mediaAsset.thumbnailUrl,
			ephemeral: mediaAsset.ephemeral,
			serverAssetId: mediaAsset.serverAssetId,
			serverDownloadUrl: mediaAsset.serverDownloadUrl,
		};

		try {
			if (
				shouldPersistMediaFileInBrowser({
					serverAssetId: mediaAsset.serverAssetId,
				})
			) {
				await mediaAssetsAdapter.set({
					key: mediaAsset.id,
					value: mediaAsset.file,
				});
			} else {
				// Remove legacy browser copies after a successful server upload.
				await mediaAssetsAdapter.remove(mediaAsset.id);
			}
			await mediaMetadataAdapter.set({
				key: mediaAsset.id,
				value: metadata,
			});
			await browserCacheRegistry.register({
				id: `media:${projectId}:${mediaAsset.id}`,
				projectId,
				assetType: "media_metadata",
				estimatedByteSize: new TextEncoder().encode(JSON.stringify(metadata))
					.byteLength,
				evictable: false,
			});
		} catch (error) {
			try {
				await mediaAssetsAdapter.remove(mediaAsset.id);
			} catch {
				// Ignore cleanup failures so the original storage error is preserved.
			}

			if (this.isQuotaExceededError({ error })) {
				throw new StorageQuotaExceededError({
					requiredBytes: mediaAsset.file.size,
				});
			}

			throw error;
		}
	}

	async loadMediaAsset({
		projectId,
		id,
	}: {
		projectId: string;
		id: string;
	}): Promise<MediaAsset | null> {
		const { mediaMetadataAdapter, mediaAssetsAdapter } =
			this.getProjectMediaAdapters({ projectId });

		const metadata = await mediaMetadataAdapter.get(id);
		const storedFile = metadata?.serverAssetId
			? null
			: await mediaAssetsAdapter.get(id);

		if (!metadata) return null;
		await browserCacheRegistry.touch(`media:${projectId}:${id}`);
		const file = metadata.serverAssetId
			? await fetchProjectMediaAsset({ assetId: metadata.serverAssetId })
			: storedFile;
		if (!file) return null;

		const restoredFile = new File([file], metadata.name, {
			type:
				metadata.mimeType ||
				file.type ||
				inferMediaMimeType({
					name: metadata.name,
					type: metadata.type,
				}),
			lastModified: metadata.lastModified,
		});

		let url: string;
		if (
			metadata.type === "image" &&
			(!restoredFile.type || restoredFile.type === "")
		) {
			try {
				const text = await restoredFile.text();
				if (text.trim().startsWith("<svg")) {
					const svgBlob = new Blob([text], { type: "image/svg+xml" });
					url = URL.createObjectURL(svgBlob);
				} else {
					url = URL.createObjectURL(restoredFile);
				}
			} catch {
				url = URL.createObjectURL(restoredFile);
			}
		} else {
			url = URL.createObjectURL(restoredFile);
		}

		return {
			id: metadata.id,
			name: metadata.name,
			type: metadata.type,
			file: restoredFile,
			url,
			width: metadata.width,
			height: metadata.height,
			duration: metadata.duration,
			fps: metadata.fps,
			hasAudio: metadata.hasAudio,
			extractedAudioAssetId: metadata.extractedAudioAssetId,
			audioExtractionStatus: metadata.audioExtractionStatus,
			sourceMediaHash: metadata.sourceMediaHash,
			sourceAssetId: metadata.sourceAssetId,
			thumbnailUrl: metadata.thumbnailUrl,
			ephemeral: metadata.ephemeral,
			serverAssetId: metadata.serverAssetId,
			serverDownloadUrl: metadata.serverDownloadUrl,
		};
	}

	async loadAllMediaAssets({
		projectId,
	}: {
		projectId: string;
	}): Promise<MediaAsset[]> {
		const { mediaMetadataAdapter } = this.getProjectMediaAdapters({
			projectId,
		});

		const mediaIds = await mediaMetadataAdapter.list();
		const mediaItems: MediaAsset[] = [];

		for (const id of mediaIds) {
			const item = await this.loadMediaAsset({ projectId, id });
			if (item) {
				mediaItems.push(item);
			}
		}

		return mediaItems;
	}

	async deleteMediaAsset({
		projectId,
		id,
	}: {
		projectId: string;
		id: string;
	}): Promise<void> {
		const { mediaMetadataAdapter, mediaAssetsAdapter } =
			this.getProjectMediaAdapters({ projectId });
		await Promise.all([
			mediaAssetsAdapter.remove(id),
			mediaMetadataAdapter.remove(id),
		]);
	}

	async deleteProjectMedia({
		projectId,
	}: {
		projectId: string;
	}): Promise<void> {
		const { mediaMetadataAdapter, mediaAssetsAdapter } =
			this.getProjectMediaAdapters({ projectId });

		await Promise.all([
			mediaMetadataAdapter.clear(),
			mediaAssetsAdapter.clear(),
			browserCacheRegistry.deleteProject(projectId),
		]);
	}

	async recoverLegacyBrowserStorage(): Promise<LegacyBrowserStorageRecoveryResult> {
		await this.ensureMigrations();
		const result: LegacyBrowserStorageRecoveryResult = {
			scannedProjects: 0,
			verifiedBackendAssets: 0,
			removedBrowserDuplicates: 0,
			requiresReimportProjects: [],
			estimatedReclaimableBytes: 0,
			reclaimedBytes: 0,
			errors: [],
		};
		const requiringReimport = new Set<string>();
		const projectIds = await this.projectsAdapter.list();
		result.scannedProjects = projectIds.length;

		for (const projectId of projectIds) {
			const { mediaMetadataAdapter } = this.getProjectMediaAdapters({
				projectId,
			});
			const metadataIds = await mediaMetadataAdapter.list().catch(() => []);
			const fileAdapters = [
				...(OPFSAdapter.isSupported()
					? [new OPFSAdapter(`media-files-${projectId}`)]
					: []),
				new IndexedDBFileAdapter({
					dbName: `${this.config.mediaDb}-${projectId}-files`,
					storeName: "media-files",
					version: this.config.version,
				}),
			];

			for (const assetId of metadataIds) {
				const metadata = await mediaMetadataAdapter.get(assetId);
				if (!metadata) continue;
				let storedBytes = 0;
				for (const adapter of fileAdapters) {
					try {
						const file = await adapter.get(assetId);
						storedBytes += file?.size ?? 0;
					} catch (error) {
						result.errors.push({
							projectId,
							assetId,
							message:
								error instanceof Error ? error.message : "Unable to read browser media store.",
						});
					}
				}
				if (storedBytes <= 0) continue;

				if (!metadata.serverAssetId) {
					requiringReimport.add(projectId);
					result.estimatedReclaimableBytes += storedBytes;
					continue;
				}

				const backendExists = await verifyProjectMediaAsset({
					assetId: metadata.serverAssetId,
				}).catch(() => false);
				if (!backendExists) {
					requiringReimport.add(projectId);
					result.estimatedReclaimableBytes += storedBytes;
					continue;
				}

				result.verifiedBackendAssets += 1;
				result.estimatedReclaimableBytes += storedBytes;
				for (const adapter of fileAdapters) {
					try {
						await adapter.remove(assetId);
					} catch (error) {
						result.errors.push({
							projectId,
							assetId,
							message:
								error instanceof Error ? error.message : "Unable to remove browser media duplicate.",
						});
					}
				}
				if (metadata.thumbnailUrl?.startsWith("blob:")) {
					URL.revokeObjectURL(metadata.thumbnailUrl);
				}
				await mediaMetadataAdapter.set({
					key: assetId,
					value: {
						...metadata,
						thumbnailUrl: metadata.thumbnailUrl?.startsWith("blob:")
							? undefined
							: metadata.thumbnailUrl,
					},
				});
				await browserCacheRegistry.register({
					id: `media:${projectId}:${assetId}`,
					projectId,
					assetType: "media_metadata",
					estimatedByteSize: new TextEncoder().encode(JSON.stringify(metadata))
						.byteLength,
					evictable: false,
				});
				result.removedBrowserDuplicates += 1;
				result.reclaimedBytes += storedBytes;
			}
		}

		result.requiresReimportProjects = [...requiringReimport];
		return result;
	}

	async clearAllData(): Promise<void> {
		await this.projectsAdapter.clear();
		// project-specific media and timelines cleaned up when projects are deleted
	}

	async getStorageInfo(): Promise<{
		projects: number;
		isOPFSSupported: boolean;
		isIndexedDBSupported: boolean;
	}> {
		const projectIds = await this.projectsAdapter.list();

		return {
			projects: projectIds.length,
			isOPFSSupported: this.isOPFSSupported(),
			isIndexedDBSupported: this.isIndexedDBSupported(),
		};
	}

	async getProjectStorageInfo({ projectId }: { projectId: string }): Promise<{
		mediaItems: number;
	}> {
		const { mediaMetadataAdapter } = this.getProjectMediaAdapters({
			projectId,
		});

		const mediaIds = await mediaMetadataAdapter.list();

		return {
			mediaItems: mediaIds.length,
		};
	}

	isOPFSSupported(): boolean {
		return OPFSAdapter.isSupported();
	}

	isIndexedDBSupported(): boolean {
		return typeof window !== "undefined" && "indexedDB" in window;
	}

	isFullySupported(): boolean {
		return this.isIndexedDBSupported();
	}
}

export const storageService = new StorageService();
export { StorageService };

function restoreSerializedScenesForDuration({
	scenes,
}: {
	scenes: SerializedScene[];
}): TScene[] {
	return scenes.map((scene) => ({
		...scene,
		createdAt: new Date(scene.createdAt),
		updatedAt: new Date(scene.updatedAt),
	}));
}

function inferMediaMimeType({
	name,
	type,
}: {
	name: string;
	type: MediaAsset["type"];
}): string {
	const extension = name.split(".").pop()?.toLowerCase();
	if (extension === "mp4" || extension === "m4v") return "video/mp4";
	if (extension === "mov") return "video/quicktime";
	if (extension === "webm") {
		return type === "audio" ? "audio/webm" : "video/webm";
	}
	if (extension === "mp3") return "audio/mpeg";
	if (extension === "wav") return "audio/wav";
	if (extension === "png") return "image/png";
	if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
	return "";
}
