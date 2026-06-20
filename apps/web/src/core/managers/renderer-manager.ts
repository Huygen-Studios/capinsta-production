import type { EditorCore } from "@/core";
import type { RootNode } from "@/services/renderer/nodes/root-node";
import { authenticatedFetch } from "@/lib/supabase/authenticated-fetch";
import type { ExportOptions, ExportResult } from "@/export";
import { normalizeExportError } from "@/export";
import { CanvasRenderer } from "@/services/renderer/canvas-renderer";
import { SceneExporter } from "@/services/renderer/scene-exporter";
import { buildScene } from "@/services/renderer/scene-builder";
import { createTimelineAudioBuffer } from "@/media/audio";
import { formatTimecode } from "opencut-wasm";
import { TICKS_PER_SECOND } from "@/wasm";
import { downloadBlob } from "@/utils/browser";
import { buildCapinstaPreviewTracks } from "@/capinsta/captionTimelineSync";
import { getCapinstaApiBaseUrl } from "@/capinsta/featureFlags";
import { mountCapinstaExportOverlayHost } from "@/capinsta/export/CapinstaExportOverlayHost";
import type { CapinstaExportOverlayHost } from "@/capinsta/export/capinsta-overlay-capture";
import {
	validateCapinstaPreExport,
	validatePreviewExportStyleParity,
	validateSingleOverlayRenderer,
	validateCapinstaHeadlessExport,
} from "@/capinsta/export/capinsta-export-validation";
import { resolveCapinstaClipStyle } from "@/capinsta/styles/styleMigration";
import { getVisibleCapinstaCaptionRecords } from "@/capinsta/captionVisibility";

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
				exportMode === "captions_solid_background" && requestedCanvasSize
					? requestedCanvasSize
					: activeProject.settings.canvasSize;

			// CapInsta captions are now rendered by a SINGLE visual renderer:
			// the React DOM overlay (CapinstaActiveCaptionOverlay for preview,
			// CapinstaExportOverlayHost for export — same React component).
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
			const tracks =
				allCapinstaRecords.length > 0
					? buildCapinstaPreviewTracks({
							records: allCapinstaRecords,
							tracks: rawTracks,
						})
					: rawTracks;

			const isDebug = process.env.NEXT_PUBLIC_CAPINSTA_DEBUG === "true";

			// Pre-export validation: single-renderer invariant, no duplicates,
			// no empty/stale captions, preview/export style hash parity.
			let overlayHost: CapinstaExportOverlayHost | undefined;
			const fallback =
				process.env.NEXT_PUBLIC_CAPINSTA_EXPORT_FALLBACK_FOREIGNOBJECT ===
				"true";

			if (
				capinstaRecords.length > 0 &&
				(exportMode === "captions_solid_background" || !fallback)
			) {
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
					const match = note.match(/Generated from Capinsta job ([a-f0-9\-]+)/);
					if (match) {
						sourceJobId = match[1];
					}
				}

				if (!sourceJobId) {
					return {
						success: false,
						error:
							"Failed to resolve transcription job ID for background export.",
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
				const formData = new FormData();
				formData.append("source_job_id", sourceJobId);
				formData.append("captions_json", captionsJson);
				formData.append(
					"theme",
					capinstaDoc.stylePresetId || "word_highlight_box",
				);
				formData.append(
					"style_config_json",
					JSON.stringify(
						resolveCapinstaClipStyle({
							document: capinstaDoc,
							clip: capinstaDoc.clips[0]!,
						}),
					),
				);
				const fpsValue =
					typeof exportFps === "number"
						? exportFps
						: typeof exportFps === "object" &&
							  exportFps !== null &&
							  "numerator" in exportFps
							? Math.round(exportFps.numerator / (exportFps.denominator || 1))
							: 30;

				formData.append(
					"resolution",
					`${canvasSize.width}x${canvasSize.height}`,
				);
				formData.append("export_width", canvasSize.width.toString());
				formData.append("export_height", canvasSize.height.toString());
				formData.append("export_fps", fpsValue.toString());
				formData.append("include_audio", includeAudio ? "true" : "false");
				formData.append("quality", quality);
				formData.append(
					"export_mode",
					exportMode === "captions_solid_background"
						? "captions_solid_background"
						: "full_video",
				);
				formData.append("captions_only", "false");
				formData.append(
					"background_color",
					exportMode === "captions_solid_background"
						? backgroundColor || "#00FF00"
						: activeProject.settings.background.type === "color"
							? activeProject.settings.background.color
							: "#101010",
				);
				// FIX: getTotalDuration() returns MediaTime in TICKS, but the backend
				// interprets duration_override as SECONDS. Convert here. Sending ticks
				// raw caused "duration 4351080.00s exceeds MAX_EXPORT_DURATION_SECONDS".
				const durationSeconds = duration / TICKS_PER_SECOND;
				formData.append("duration_override", durationSeconds.toString());
				formData.append("duration_source", "frontend");
				formData.append("render_mode", "headless");

				// 4. Send POST request to start export job
				const apiBase = getCapinstaApiBaseUrl() || "http://localhost:8000";
				onProgress?.({ progress: 0.05 });

				const response = await authenticatedFetch(
					`${apiBase}/api/export/jobs`,
					{
						method: "POST",
						body: formData,
					},
				);

				if (!response.ok) {
					const errData = await response.json().catch(() => ({}));
					return {
						success: false,
						error: normalizeExportError(
							errData.detail ||
								errData.error ||
								`Export API returned HTTP ${response.status}`,
						),
					};
				}

				const startData = await response.json();
				const jobId = startData.jobId;
				if (!jobId) {
					return {
						success: false,
						error: "Export API did not return a job ID.",
					};
				}

				// 5. Poll status
				const statusUrl = `${apiBase}/api/export/jobs/${jobId}`;
				let isComplete = false;
				let pollError: string | null = null;
				let downloadUrl: string | null = null;

				while (!isComplete && !pollError) {
					if (onCancel?.()) {
						return { success: false, cancelled: true };
					}

					await new Promise((resolve) => setTimeout(resolve, 1500));

					const pollRes = await authenticatedFetch(statusUrl);
					if (!pollRes.ok) {
						pollError = `Status check failed with HTTP ${pollRes.status}`;
						break;
					}

					const jobStatus = await pollRes.json();
					if (jobStatus.status === "completed") {
						isComplete = true;
						downloadUrl = jobStatus.downloadUrl;
					} else if (jobStatus.status === "failed") {
						pollError = normalizeExportError(
							jobStatus.error ||
								jobStatus.message ||
								"Export job failed on server.",
						);
					} else {
						const progress = jobStatus.progress || 0;
						onProgress?.({ progress: 0.05 + (progress / 100) * 0.9 });
					}
				}

				if (pollError) {
					return { success: false, error: pollError };
				}

				if (!downloadUrl) {
					return {
						success: false,
						error: "No download URL returned for finished export.",
					};
				}

				// 6. Fetch output file and return as ArrayBuffer
				onProgress?.({ progress: 0.98 });
				const fileRes = await authenticatedFetch(`${apiBase}${downloadUrl}`);
				if (!fileRes.ok) {
					return {
						success: false,
						error: `Failed to download exported video from ${downloadUrl}`,
					};
				}

				const buffer = await fileRes.arrayBuffer();
				onProgress?.({ progress: 1.0 });

				return {
					success: true,
					buffer,
				};
			} else if (capinstaRecords.length > 0 && fallback) {
				// Pre-export validation for fallback path
				const preCheck = validateCapinstaPreExport({
					records: capinstaRecords,
					canvasWidth: canvasSize.width,
					canvasHeight: canvasSize.height,
				});
				if (isDebug) {
					console.debug("[capinsta-export] pre-export validation (fallback)", {
						severity: preCheck.severity,
						checks: preCheck.checks,
						exportFps,
						canvasSize: `${canvasSize.width}x${canvasSize.height}`,
						rendererPath: "react_overlay_only (CapinstaExportOverlayHost)",
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
					console.debug(
						"[capinsta-export] preview/export style parity (fallback)",
						{
							severity: parity.severity,
							checks: parity.checks,
						},
					);
				}
				if (parity.severity === "error") {
					return {
						success: false,
						error:
							"CapInsta preview/export style hash mismatch — " +
							"preview and export would render captions differently.",
					};
				}

				const mounted = await mountCapinstaExportOverlayHost({
					records: capinstaRecords,
					canvasWidth: canvasSize.width,
					canvasHeight: canvasSize.height,
				});
				overlayHost = mounted.host;
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
				background: activeProject.settings.background,
				capinstaCaptionDocuments: capinstaRecords,
			});

			const editorPlayback = this.editor.playback;

			// Seek helper: convert seconds → ticks (MediaTime) for the playback API.
			// MediaTime is a branded opaque type; the only safe way to create one
			// from a number is via the playback.seek() itself. However, seek() only
			// accepts MediaTime, so we cast here. The relationship between seconds
			// and ticks is deterministic (ticks = seconds * TICKS_PER_SECOND), and
			// the seek function internally uses the same ticks, so this is safe.
			const seekToExportTime = (timeSeconds: number) => {
				const timeTicks = Math.round(timeSeconds * TICKS_PER_SECOND);
				editorPlayback.seek({
					time: timeTicks as unknown as import("@/wasm").MediaTime,
				});
			};

			const exporter = new SceneExporter({
				width: canvasSize.width,
				height: canvasSize.height,
				fps: exportFps,
				format,
				quality,
				shouldIncludeAudio: !!includeAudio,
				audioBuffer: audioBuffer || undefined,
				overlayHost,
				// FIX O: During export, advance the editor preview playback to each
				// frame's time so the live preview overlay stays in sync with the
				// export frame time instead of showing a stuck first caption.
				onOverlayFrame({ frameTimeSeconds }) {
					seekToExportTime(frameTimeSeconds);
				},
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

				// Post-export single-renderer assertion + completion log.
				const rendererCheck = validateSingleOverlayRenderer({
					overlayHostsMounted: overlayHost ? 1 : 0,
				});
				if (isDebug) {
					console.debug("[capinsta-export] export complete", {
						bufferBytes: buffer.byteLength,
						format,
						duration,
						fps: exportFps,
						rendererChecks: rendererCheck.checks,
						overlayReport: exporter.lastOverlayReport,
					});
				}

				return {
					success: true,
					buffer,
				};
			} finally {
				clearInterval(cancelInterval);
				// Always dispose the overlay host to unmount React + free DOM.
				if (overlayHost) {
					try {
						await overlayHost.dispose();
					} catch (disposeErr) {
						console.warn(
							"[capinsta-export] overlay host dispose failed",
							disposeErr,
						);
					}
				}
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
