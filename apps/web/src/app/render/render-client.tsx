"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CapinstaCaptionRenderer } from "@/capinsta/render/CapinstaCaptionRenderer";
import { createCapinstaRenderModelFromIndex } from "@/capinsta/render/capinstaRenderModel";
import {
	createCapinstaCaptionTimingIndex,
	getActiveCapinstaCaptionStateFromIndex,
} from "@/capinsta/captionTimingIndex";
import type {
	NeutralCaptionDocument,
	CapinstaCaptionDocumentRecord,
} from "@/capinsta/types";
import { computeCaptionStyleHash, summarizeCaptionStyle } from "@/capinsta/export/exportStyleHash";
import {
	resolveCapinstaCaptionLayout,
	summarizeCaptionLayout,
	computeCaptionLayoutHash,
} from "@/capinsta/export/captionLayoutDiagnostics";
import { resolveCapinstaClipStyle } from "@/capinsta/styles/styleMigration";

// ─── Global type declarations for the render page API ──────────────────────

declare global {
	interface Window {
		__RENDER_PAGE_LOADED__: boolean;
		__RENDER_PAGE_LAST_ERROR__: string;
		__OVERLAY_ONLY_MODE__: boolean;
		HUYGEN_RENDER_MODE: string;
		__EXPORT_OVERLAY_RECT__: { width: number; height: number } | null;
		__EXPORT_STYLE_HASH__: string | null;
		__EXPORT_STYLE_INFO__: Record<string, unknown> | null;
		__EXPORT_LAYOUT_INFO__: Record<string, unknown> | null;
		__EXPORT_LAYOUT_HASH__: string | null;
		__EXPORT_DEBUG_OVERLAYS_FOUND__: number | null;
		setCaptionData(
			captionsJson: string,
			theme: string,
			width: number,
			height: number,
			styleConfigJson: string,
			fps: number,
			backgroundColor: string,
			compositionJson: string,
			renderMode: string,
			jobId: string,
			duration: number,
			audioIncluded: boolean,
		): { ok: boolean; error?: string; detail?: string };
		setCaptionTime(timeSeconds: number): void;
		setCaptionFrame(frameIndex: number): void;
		isReady(): boolean;
	}
}

interface CaptionState {
	records: CapinstaCaptionDocumentRecord[];
	width: number;
	height: number;
	fps: number;
	theme: string;
	backgroundColor: string;
	renderMode: string;
	duration: number;
	jobId: string;
}

export function RenderPageClient() {
	const [captionState, setCaptionState] = useState<CaptionState | null>(null);
	const [timeSeconds, setTimeSeconds] = useState(0);
	const overlayRootRef = useRef<HTMLDivElement>(null);
	const stateRef = useRef<CaptionState | null>(null);
	const fpsRef = useRef(30);

	const applyState = useCallback((state: CaptionState) => {
		stateRef.current = state;
		fpsRef.current = state.fps || 30;
		setCaptionState(state);

		// Expose globals for post-inject validation
		if (typeof window !== "undefined") {
			window.__OVERLAY_ONLY_MODE__ = true;
			window.HUYGEN_RENDER_MODE = state.renderMode || "full_video";
			window.__EXPORT_DEBUG_OVERLAYS_FOUND__ = 0;
		}
	}, []);

	useEffect(() => {
		if (typeof window === "undefined") return;

		// Mark page as loaded
		window.__RENDER_PAGE_LOADED__ = true;
		window.__RENDER_PAGE_LAST_ERROR__ = "";
		window.__OVERLAY_ONLY_MODE__ = true;
		window.HUYGEN_RENDER_MODE = "full_video";
		window.__EXPORT_OVERLAY_RECT__ = null;
		window.__EXPORT_STYLE_HASH__ = null;
		window.__EXPORT_STYLE_INFO__ = null;
		window.__EXPORT_LAYOUT_INFO__ = null;
		window.__EXPORT_LAYOUT_HASH__ = null;
		window.__EXPORT_DEBUG_OVERLAYS_FOUND__ = null;

		window.isReady = () => window.__RENDER_PAGE_LOADED__ === true;

		/**
		 * setCaptionData — called by the backend to inject caption data before
		 * frame capture begins.
		 */
		window.setCaptionData = (
			captionsJson,
			theme,
			width,
			height,
			_styleConfigJson,
			fps,
			backgroundColor,
			_compositionJson,
			renderMode,
			jobId,
			duration,
			_audioIncluded,
		) => {
			try {
				const captions = JSON.parse(captionsJson || "[]");
				if (!Array.isArray(captions)) {
					window.__RENDER_PAGE_LAST_ERROR__ = "captions must be an array";
					return { ok: false, error: "captions must be an array" };
				}

				// Build a CapinstaCaptionDocumentRecord from the raw captions array.
				// The backend sends an array of clip objects with embedded words.
				const clips = captions.map((clip: any, i: number) => ({
					id: clip.id ?? `clip-${i}`,
					trackId: clip.trackId ?? "capinsta-export",
					start: Number(clip.start ?? 0),
					end: Number(clip.end ?? 0),
					text: clip.text ?? "",
					wordIds: (clip.words ?? []).map((w: any, wi: number) =>
						w.id ?? `word-${i}-${wi}`,
					),
					stylePresetId: clip.stylePresetId ?? theme ?? "word_highlight_box",
					selected: false,
					editable: false,
					manuallyEdited: false,
					timingNeedsReview: false,
					timingSource: "provider" as const,
					style: clip.style ?? undefined,
					sourceClipId: clip.id ?? `clip-${i}`,
				}));

				const words = captions.flatMap((clip: any, i: number) =>
					(clip.words ?? []).map((w: any, wi: number) => ({
						id: w.id ?? `word-${i}-${wi}`,
						text: w.text ?? w.word ?? "",
						displayedText: w.displayedWord ?? w.text ?? w.word ?? "",
						start: Number(w.start ?? 0),
						end: Number(w.end ?? 0),
						timingSource: "provider" as const,
						sourceWordId: w.id ?? `word-${i}-${wi}`,
					})),
				);

				const doc: NeutralCaptionDocument = {
					id: `export-doc-${jobId}`,
					trackId: "capinsta-export",
					sourceTranscriptRef: {
						version: "capinsta.transcript.v1",
						sourceAssetId: jobId,
						sourceAssetName: "export",
						provider: "export",
					},
					durationSeconds: duration,
					languageMode: "english",
					stylePresetId: theme ?? "word_highlight_box",
					clips,
					words,
					manualEdits: {},
					timing: {
						sourceOfTruth: "clips",
						generatedAt: new Date().toISOString(),
					},
				};

				const record: CapinstaCaptionDocumentRecord = {
					document: doc,
					openCutTrackId: "capinsta-export",
					importedAt: new Date().toISOString(),
				};

				applyState({
					records: [record],
					width: Number(width),
					height: Number(height),
					fps: Number(fps) || 30,
					theme: theme ?? "word_highlight_box",
					backgroundColor: backgroundColor ?? "transparent",
					renderMode: renderMode ?? "full_video",
					duration: Number(duration),
					jobId,
				});

				// Update overlay rect after state sets on next paint.
				requestAnimationFrame(() => {
					if (overlayRootRef.current) {
						const rect = overlayRootRef.current.getBoundingClientRect();
						window.__EXPORT_OVERLAY_RECT__ = {
							width: rect.width,
							height: rect.height,
						};
						window.__EXPORT_LAYOUT_INFO__ = {
							canvasWidth: width,
							canvasHeight: height,
						};
					}
				});

				return { ok: true };
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				window.__RENDER_PAGE_LAST_ERROR__ = msg;
				return { ok: false, error: "Failed to parse caption data", detail: msg };
			}
		};

		/** setCaptionTime — advance overlay to given time in seconds */
		window.setCaptionTime = (time: number) => {
			setTimeSeconds(time);
			return true;
		};

		/** setCaptionFrame — advance overlay by frame index */
		window.setCaptionFrame = (frame: number) => {
			const fps = fpsRef.current;
			setTimeSeconds(frame / Math.max(1, fps));
			return true;
		};
	}, [applyState]);

	// Update style/layout globals whenever active caption changes
	useEffect(() => {
		if (!captionState || typeof window === "undefined") return;
		const { records, width, height } = captionState;
		const index = createCapinstaCaptionTimingIndex({ records });
		const activeState = getActiveCapinstaCaptionStateFromIndex({ index, timeSeconds });
		if (!activeState) return;
		try {
			const style = resolveCapinstaClipStyle({
				document: activeState.document,
				clip: activeState.clip,
			});
			window.__EXPORT_STYLE_HASH__ = computeCaptionStyleHash(style);
			window.__EXPORT_STYLE_INFO__ = summarizeCaptionStyle(style);
			try {
				const resolved = resolveCapinstaCaptionLayout(style, width, height);
				window.__EXPORT_LAYOUT_INFO__ = {
					...summarizeCaptionLayout(resolved),
					canvasWidth: width,
					canvasHeight: height,
				};
				window.__EXPORT_LAYOUT_HASH__ = computeCaptionLayoutHash(resolved);
			} catch {
				// non-fatal
			}
		} catch {
			// non-fatal
		}
	}, [captionState, timeSeconds]);

	if (!captionState) {
		// Page loaded, awaiting setCaptionData injection
		return (
			<div
				id="render-frame"
				style={{ width: "100vw", height: "100vh", background: "transparent" }}
			/>
		);
	}

	const { records, width, height } = captionState;
	const index = createCapinstaCaptionTimingIndex({ records });
	const activeState = getActiveCapinstaCaptionStateFromIndex({ index, timeSeconds });
	const viewport = { width, height };
	const renderModel = activeState
		? createCapinstaRenderModelFromIndex({
				index,
				timeSeconds,
				rendererPath: "rendered_capinsta_wysiwyg",
				viewport,
			})
		: null;

	return (
		<div
			id="render-frame"
			data-capinsta-export-overlay-root="true"
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				width,
				height,
				overflow: "hidden",
				background: "transparent",
				pointerEvents: "none",
			}}
			ref={overlayRootRef}
		>
			{activeState && renderModel && (
				<CapinstaCaptionRenderer
					renderModel={renderModel}
					activeWordIds={activeState.activeWordIds}
					timeSeconds={timeSeconds}
					isPlaying={false}
					viewport={viewport}
				/>
			)}
		</div>
	);
}
