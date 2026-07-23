import type { EditorCore } from "@/core";
import type { RootNode } from "@/services/renderer/nodes/root-node";
import { authenticatedFetch } from "@/lib/supabase/authenticated-fetch";
import type { ExportOptions, ExportResult } from "@/export";
import { formatExportApiError, normalizeExportError } from "@/export";
import { CanvasRenderer } from "@/services/renderer/canvas-renderer";
import { SceneExporter } from "@/services/renderer/scene-exporter";
import { buildScene } from "@/services/renderer/scene-builder";
import { createTimelineAudioBuffer } from "@/media/audio";
import { formatTimecode } from "opencut-wasm";
import { TICKS_PER_SECOND } from "@/wasm";
import { downloadBlob } from "@/utils/browser";
import { buildCapinstaPreviewTracks } from "@/capinsta/captionTimelineSync";
import { buildCapinstaApiUrl } from "@/capinsta/api-url";
import { getCapinstaApiBaseUrl } from "@/capinsta/featureFlags";
import { readJsonApiResponse } from "@/capinsta/api-response";
import {
	validateCapinstaPreExport,
	validatePreviewExportStyleParity,
	validateCapinstaHeadlessExport,
} from "@/capinsta/export/capinsta-export-validation";
import { resolveCapinstaClipStyle } from "@/capinsta/styles/styleMigration";
import { getVisibleCapinstaCaptionRecords } from "@/capinsta/captionVisibility";
import {
	resolveExportSceneBackground,
	resolveSolidExportBackground,
} from "@/export/color";
import {
	applyExportLayerPolicy,
	exportLayerPolicyForMode,
} from "@/export/layer-policy";
import { createExportRequestFormData } from "@/export/request";
import { validateExportOutput } from "@/export/output-limits";
import {
	resolveCapinstaExportRoute,
	resolveCapinstaExportStrategy,
} from "@/export/strategy";

type SnapshotResult =
	| { success: true; blob: Blob; filename: string }
	| { success: false; error: string };

export class RendererManager {
	private renderTree: RootNode | null = null;
	private _isDegraded = false;
	private listeners = new Set<() => void>();

	constructor(private editor: EditorCore) {}

	get isDegraded(): boolean {
		return this._isDegraded;
	}

	setDegraded(degraded: boolean): void {
		if (this._isDegraded === degraded) return;
		this._isDegraded = degraded;
		this.notify();
	}

	setRenderTree({ renderTree }: { renderTree: RootNode | null }): void {
		this.renderTree = renderTree;
		this.notify();
	}

	getRenderTree(): RootNode | null {
		return this.renderTree;
	}

	async saveSnapshot(): Promise<{ success: boolean; error?: string }> {
		const snapshot = await this.createSnapshot();
		if (!snapshot.success) {
			return snapshot;
		}

		downloadBlob({ blob: snapshot.blob, filename: snapshot.filename });
		return { success: true };
	}

	async copySnapshot(): Promise<{ success: boolean; error?: string }> {
		if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
			return {
				success: false,
				error: "Clipboard image copy is not supported in this browser",
			};
		}

		const snapshot = await this.createSnapshot();
		if (!snapshot.success) {
			return snapshot;
		}

		try {
			await navigator.clipboard.write([
				new ClipboardItem({
					[snapshot.blob.type || "image/png"]: snapshot.blob,
				}),
			]);
			return { success: true };
		} catch (error) {
			console.error("Copy snapshot failed:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	private async createSnapshot(): Promise<SnapshotResult> {
		try {
			const renderTree = this.getRenderTree();
			const activeProject = this.editor.project.getActive();

			if (!renderTree || !activeProject) {
				return { success: false, error: "No project or scene to capture" };
			}

			const duration = this.editor.timeline.getTotalDuration();
			if (duration === 0) {
				return { success: false, error: "Project is empty" };
			}

			const { canvasSize, fps } = activeProject.settings;
			const renderTime = Math.min(
				this.editor.playback.getCurrentTime(),
				this.editor.timeline.getLastFrameTime(),
			);

			const renderer = new CanvasRenderer({
				width: canvasSize.width,
				height: canvasSize.height,
				fps,
			});

			const tempCanvas = document.createElement("canvas");
			tempCanvas.width = canvasSize.width;
			tempCanvas.height = canvasSize.height;

			await renderer.renderToCanvas({
				node: renderTree,
				time: renderTime,
				targetCanvas: tempCanvas,
			});

			const blob = await new Promise<Blob | null>((resolve) => {
				tempCanvas.toBlob((result) => resolve(result), "image/png");
			});

			if (!blob) {
				return { success: false, error: "Failed to create image" };
			}

			const timecode = formatTimecode({ time: renderTime, rate: fps })!.replace(
				/:/g,
				"-",
			);
			const safeName =
				activeProject.metadata.name.replace(/[<>:"/\\|?*]/g, "-").trim() ||
				"snapshot";
			const filename = `${safeName}-${timecode}.png`;

			return { success: true, blob, filename };
		} catch (error) {
			console.error("Snapshot capture failed:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	async exportProject({
		options,
		onProgress,
		onCancel,
	}: {
		options: ExportOptions;
		onProgress?: ({ progress }: { progress: number }) => void;
		onCancel?: () => boolean;
	}): Promise<ExportResult> {
		const {
			exportMode,
			format,
			quality,
			fps,
			includeAudio,
			backgroundColor,
			canvasSize: requestedCanvasSize,
		} = options;

		try {
			const rawTracks = this.editor.scenes.getActiveScene().tracks;
			const mediaAssets = this.editor.media.getAssets();
			const activeProject = this.editor.project.getActive();

			if (!activeProject) {
				return { success: false, error: "No active project" };
			}

			const duration = this.editor.timeline.getTotalDuration();
			if (duration === 0) {
				return { success: false, error: "Project is empty" };
			}

			const exportFps = fps ?? activeProject.settings.fps;
			const canvasSize =
				requestedCanvasSize ?? activeProject.settings.canvasSize;
			const exportFpsValue =
				typeof exportFps === "number"
					? exportFps
					: exportFps.numerator / (exportFps.denominator || 1);
			const outputValidationError = validateExportOutput({
				width: canvasSize.width,
				height: canvasSize.height,
				fps: exportFpsValue,
			});
			if (outputValidationError) {
				return { success: false, error: outputValidationError };
			}
			const normalizedBackgroundColor = resolveSolidExportBackground({
				value: backgroundColor,
			});
			const layerPolicy = exportLayerPolicyForMode({ exportMode });
			const exportBackground = resolveExportSceneBackground({
				exportMode,
				requestedColor: backgroundColor,
				projectBackground: activeProject.settings.background,
			});

			// CapInsta captions use one authoritative export renderer: the
			// authenticated /render page controlled by the Playwright worker.
			// The canvas/WASM/TextNode/CapinstaCaptionNode pipeline renders ZERO
			// caption pixels. We still run tracks through buildCapinstaPreviewTracks
			// so the capinsta carrier TextElements get hidden:true before scene
			// building (defense in depth — they also suppress in renderTextToContext).
			const allCapinstaRecords = activeProject.capinstaCaptionDocuments ?? [];
			const capinstaRecords = getVisibleCapinstaCaptionRecords({
				records: allCapinstaRecords,
				tracks: rawTracks,
				includeHidden: exportMode === "captions_solid_background",
			});
			const captionPreparedTracks =
				allCapinstaRecords.length > 0
					? buildCapinstaPreviewTracks({
							records: allCapinstaRecords,
							tracks: rawTracks,
						})
					: rawTracks;
			const tracks = applyExportLayerPolicy({
				tracks: captionPreparedTracks,
				policy: layerPolicy,
			});
			const exportStrategy = resolveCapinstaExportStrategy({
				configured: process.env.NEXT_PUBLIC_CAPINSTA_EXPORT_STRATEGY,
				legacyForeignObjectFallback:
					process.env.NEXT_PUBLIC_CAPINSTA_EXPORT_FALLBACK_FOREIGNOBJECT,
			});
			const exportRoute = resolveCapinstaExportRoute({
				exportMode,
				captionRecordCount: capinstaRecords.length,
				strategy: exportStrategy,
			});
			const useHeadlessCaptionBackend = exportRoute === "headless-worker";

			console.info("[export] composition request", {
				exportMode,
				layerPolicy,
				requestedBackgroundColor: backgroundColor ?? null,
				normalizedBackgroundColor,
				finalBackgroundColor:
					exportBackground.type === "color"
						? exportBackground.color
						: exportBackground.type,
				width: canvasSize.width,
				height: canvasSize.height,
				requestedFps: fps ?? null,
				effectiveFps: exportFps,
				renderPath: useHeadlessCaptionBackend
					? "headless-playwright-backend"
					: "shared-scene-exporter",
			});

			const isDebug = process.env.NEXT_PUBLIC_CAPINSTA_DEBUG === "true";

			// Pre-export validation: single-renderer invariant, no duplicates,
			// no empty/stale captions, preview/export style hash parity.
			if (useHeadlessCaptionBackend) {
				// 1. Pre-export validation
				const preCheck = validateCapinstaPreExport({
					records: capinstaRecords,
					canvasWidth: canvasSize.width,
					canvasHeight: canvasSize.height,
				});
				if (isDebug) {
					console.debug("[capinsta-export] pre-export validation", {
						severity: preCheck.severity,
						checks: preCheck.checks,
						exportFps,
						canvasSize: `${canvasSize.width}x${canvasSize.height}`,
						rendererPath: "headless (Playwright background export)",
					});
				}
				if (preCheck.severity === "error") {
					const failed = preCheck.checks
						.filter((c) => !c.passed)
						.map((c) => c.name)
						.join(", ");
					return {
						success: false,
						error: `CapInsta export validation failed: ${failed}`,
					};
				}

				const parity = validatePreviewExportStyleParity({
					records: capinstaRecords,
					canvasWidth: canvasSize.width,
					canvasHeight: canvasSize.height,
				});
				if (isDebug) {
					console.debug("[capinsta-export] preview/export style parity", {
						severity: parity.severity,
						checks: parity.checks,
					});
				}
				if (parity.severity === "error") {
					return {
						success: false,
						error:
							"CapInsta preview/export style hash mismatch — " +
							"preview and export would render captions differently.",
					};
				}

				// 2. Resolve sourceJobId from notes
				const capinstaDoc = capinstaRecords[0]?.document;
				let sourceJobId = "";
				if (capinstaDoc) {
					const note = capinstaDoc.manualEdits?.notes?.[0] || "";
					const match = note.match(/Generated from Capinsta job ([a-f0-9-]+)/);
					if (match) {
						sourceJobId = match[1];
					}
				}

				if (!sourceJobId) {
					return {
						success: false,
						error:
							"Failed to resolve the source caption job for export. Regenerate captions for this project, then retry.",
					};
				}

				// Headless-specific validation: timing, dimensions, job id format.
				const headlessCheck = validateCapinstaHeadlessExport({
					records: capinstaRecords,
					canvasWidth: canvasSize.width,
					canvasHeight: canvasSize.height,
					sourceJobId,
				});
				if (isDebug) {
					console.debug("[capinsta-export] headless validation", {
						severity: headlessCheck.severity,
						checks: headlessCheck.checks,
						sourceJobId,
					});
				}
				if (headlessCheck.severity === "error") {
					const failed = headlessCheck.checks
						.filter((c) => !c.passed)
						.map((c) => c.name)
						.join(", ");
					return {
						success: false,
						error: `CapInsta headless export validation failed: ${failed}`,
					};
				}

				// 3. Prepare payload
				const wordsById = new Map(
					capinstaDoc.words.map((word) => [word.id, word]),
				);
				const captionsJson = JSON.stringify(
					capinstaDoc.clips.map((clip) => ({
						...clip,
						style: resolveCapinstaClipStyle({
							document: capinstaDoc,
							clip,
						}),
						words: clip.wordIds
							.map((wordId) => wordsById.get(wordId))
							.filter((word) => word !== undefined),
					})),
				);
				const fpsValue = Math.round(exportFpsValue);

				// FIX: getTotalDuration() returns MediaTime in TICKS, but the backend
				// interprets duration_override as SECONDS. Convert here. Sending ticks
				// raw caused "duration 4351080.00s exceeds MAX_EXPORT_DURATION_SECONDS".
				const durationSeconds = duration / TICKS_PER_SECOND;
				const formData = createExportRequestFormData({
					sourceJobId,
					captionsJson,
					theme: capinstaDoc.stylePresetId || "word_highlight_box",
					styleConfigJson: JSON.stringify(
						resolveCapinstaClipStyle({
							document: capinstaDoc,
							clip: capinstaDoc.clips[0]!,
						}),
					),
					width: canvasSize.width,
					height: canvasSize.height,
					fps: fpsValue,
					includeAudio: Boolean(includeAudio),
					quality,
					exportMode,
					backgroundColor: normalizedBackgroundColor,
					durationSeconds,
				});

				// 4. Send POST request to start export job
				const apiBase = getCapinstaApiBaseUrl();
				onProgress?.({ progress: 0.05 });
				const exportEndpoint = buildCapinstaApiUrl({
					baseUrl: apiBase,
					path: "/export/jobs",
				});
				const idempotencyKey = crypto.randomUUID();
				let response: Response;
				try {
					response = await authenticatedFetch(exportEndpoint, {
						method: "POST",
						body: formData,
						headers: { "X-Idempotency-Key": idempotencyKey },
					});
				} catch (firstError) {
					if (!(firstError instanceof TypeError) || !navigator.onLine) {
						throw firstError;
					}
					await new Promise((resolve) => setTimeout(resolve, 750));
					try {
						response = await authenticatedFetch(exportEndpoint, {
							method: "POST",
							body: formData,
							headers: { "X-Idempotency-Key": idempotencyKey },
						});
					} catch (retryError) {
						if (retryError instanceof TypeError) {
							throw new Error(
								`Could not reach the export service at ${apiBase}. Check that the backend deployment is healthy, then retry.`,
							);
						}
						throw retryError;
					}
				}

				const startData = await readJsonApiResponse<Record<string, unknown>>({
					response,
					endpoint: exportEndpoint,
				});
				if (!response.ok) {
					return {
						success: false,
						error: formatExportApiError({
							endpoint: exportEndpoint,
							status: response.status,
							payload: startData,
							correlationId: response.headers.get("x-correlation-id"),
						}),
					};
				}

				const jobId =
					typeof startData.jobId === "string" ? startData.jobId : null;
				const correlationId =
					response.headers.get("x-correlation-id") ??
					(typeof startData.correlationId === "string"
						? startData.correlationId
						: null) ??
					null;
				if (!jobId) {
					return {
						success: false,
						error: formatExportApiError({
							endpoint: exportEndpoint,
							status: response.status,
							payload: {
								stage: "create_job",
								error: "Export API did not return a job ID.",
							},
							correlationId,
						}),
					};
				}

				// 5. Poll status
				const statusUrl = buildCapinstaApiUrl({
					baseUrl: apiBase,
					path: `/export/jobs/${jobId}`,
				});
				let isComplete = false;
				let pollError: string | null = null;
				let downloadUrl: string | null = null;

				while (!isComplete && !pollError) {
					if (onCancel?.()) {
						return { success: false, cancelled: true };
					}

					await new Promise((resolve) => setTimeout(resolve, 1500));

					const pollRes = await authenticatedFetch(statusUrl);
					const jobStatus = await readJsonApiResponse<Record<string, unknown>>({
						response: pollRes,
						endpoint: statusUrl,
					});
					if (!pollRes.ok) {
						pollError = formatExportApiError({
							endpoint: statusUrl,
							status: pollRes.status,
							payload: jobStatus,
							correlationId:
								pollRes.headers.get("x-correlation-id") ?? correlationId,
							jobId,
						});
						break;
					}

					if (jobStatus.status === "completed") {
						isComplete = true;
						downloadUrl =
							typeof jobStatus.downloadUrl === "string"
								? jobStatus.downloadUrl
								: null;
					} else if (jobStatus.status === "failed") {
						pollError = formatExportApiError({
							endpoint: statusUrl,
							status: pollRes.status,
							payload: {
								stage: jobStatus.stage,
								error:
									jobStatus.error ||
									jobStatus.message ||
									"Export job failed on server.",
							},
							correlationId:
								typeof jobStatus.correlationId === "string"
									? jobStatus.correlationId
									: correlationId,
							jobId,
						});
					} else {
						const progress =
							typeof jobStatus.progress === "number" ? jobStatus.progress : 0;
						onProgress?.({ progress: 0.05 + (progress / 100) * 0.9 });
					}
				}

				if (pollError) {
					return { success: false, error: pollError };
				}

				if (!downloadUrl) {
					return {
						success: false,
						error: formatExportApiError({
							endpoint: statusUrl,
							status: 200,
							payload: {
								stage: "resolve_output",
								error: "No download URL returned for finished export.",
							},
							correlationId,
							jobId,
						}),
					};
				}

				// 6. Fetch output file and return as ArrayBuffer
				onProgress?.({ progress: 0.98 });
				const fileRes = await authenticatedFetch(`${apiBase}${downloadUrl}`);
				if (!fileRes.ok) {
					return {
						success: false,
						error: formatExportApiError({
							endpoint: `${apiBase}${downloadUrl}`,
							status: fileRes.status,
							payload: {
								stage: "download_output",
								error: "Failed to download the completed export.",
							},
							correlationId:
								fileRes.headers.get("x-correlation-id") ?? correlationId,
							jobId,
						}),
					};
				}

				const buffer = await fileRes.arrayBuffer();
				onProgress?.({ progress: 1.0 });

				return {
					success: true,
					buffer,
				};
			}

			let audioBuffer: AudioBuffer | null = null;
			if (includeAudio) {
				onProgress?.({ progress: 0.05 });
				audioBuffer = await createTimelineAudioBuffer({
					tracks,
					mediaAssets,
					duration,
				});
			}

			const scene = buildScene({
				tracks,
				mediaAssets,
				duration,
				canvasSize,
				background: exportBackground,
				isPreview: false,
				capinstaCaptionDocuments: capinstaRecords,
			});

			const exporter = new SceneExporter({
				width: canvasSize.width,
				height: canvasSize.height,
				fps: exportFps,
				format,
				quality,
				shouldIncludeAudio: !!includeAudio,
				audioBuffer: audioBuffer || undefined,
			});

			exporter.on("progress", (progress) => {
				const adjustedProgress = includeAudio
					? 0.05 + progress * 0.95
					: progress;
				onProgress?.({ progress: adjustedProgress });
			});

			let cancelled = false;
			const checkCancel = () => {
				if (onCancel?.()) {
					cancelled = true;
					exporter.cancel();
				}
			};

			const cancelInterval = setInterval(checkCancel, 100);

			try {
				const buffer = await exporter.export({ rootNode: scene });
				clearInterval(cancelInterval);

				if (cancelled) {
					return { success: false, cancelled: true };
				}

				if (!buffer) {
					return { success: false, error: "Export failed to produce buffer" };
				}

				if (isDebug) {
					console.debug("[capinsta-export] export complete", {
						bufferBytes: buffer.byteLength,
						format,
						duration,
						fps: exportFps,
						overlayReport: exporter.lastOverlayReport,
					});
				}

				return {
					success: true,
					buffer,
				};
			} finally {
				clearInterval(cancelInterval);
			}
		} catch (error) {
			console.error("Export failed:", error);
			return {
				success: false,
				error: normalizeExportError(error),
			};
		}
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		this.listeners.forEach((fn) => {
			fn();
		});
	}
}
