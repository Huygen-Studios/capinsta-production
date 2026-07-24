"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useEditor } from "@/editor/use-editor";
import { mediaTimeToSeconds, type MediaTime } from "@/wasm";
import { CapinstaCaptionRenderer } from "@/capinsta/render/CapinstaCaptionRenderer";
import {
	activeCapinstaCaptionStateKey,
	createCapinstaCaptionTimingIndex,
	getActiveCapinstaCaptionStateFromIndex,
} from "@/capinsta/captionTimingIndex";
import { createCapinstaRenderModelFromIndex } from "@/capinsta/render/capinstaRenderModel";
import { resolveCapinstaClipStyle } from "@/capinsta/styles/styleMigration";
import {
	computeCaptionStyleHash,
	summarizeCaptionStyle,
} from "@/capinsta/export/exportStyleHash";
import {
	resolveCapinstaCaptionLayout,
	summarizeCaptionLayout,
	computeCaptionLayoutHash,
} from "@/capinsta/export/captionLayoutDiagnostics";
import { getVisibleCapinstaCaptionRecords } from "@/capinsta/captionVisibility";
import {
	ensureCapinstaFontLoaded,
	normalizeCapinstaFontWeight,
} from "@/capinsta/fonts/captionFontRegistry";
import {
	normalizePaperFoldParams,
	type PaperFoldParams,
} from "@/effects/paper-fold/types";
import { getPaperFoldManifest } from "@/effects/paper-fold/assets";
import { resolvePaperFoldTiming } from "@/effects/paper-fold/timing";
import type { TimelineElement } from "@/timeline";

declare global {
	interface Window {
		__CAPINSTA_LAST_PREVIEW_MANIFEST?: unknown;
		__CAPINSTA_LAST_EXPORT_PREVIEW_MANIFEST?: unknown;
		__CAPINSTA_LAST_EXPORT_MANIFEST?: unknown;
		__PREVIEW_STYLE_HASH__?: string;
		__PREVIEW_STYLE_INFO__?: Record<string, unknown> | null;
		__PREVIEW_LAYOUT_INFO__?: Record<string, unknown> | null;
		__PREVIEW_LAYOUT_HASH__?: string;
		__CAPSTA_ACTIVE_FRAME_INFO__: {
			activeCaptionId: string;
			activeWordId: string;
			captionText: string;
		} | null;
	}
}

const PLAYING_OVERLAY_MIN_UPDATE_MS = 0;

export function CapinstaActiveCaptionOverlay({
	sceneLeft,
	sceneTop,
	sceneWidth,
	sceneHeight,
	canvasWidth,
	canvasHeight,
	allowWithoutTextTrack = false,
	renderTimeSeconds,
}: {
	sceneLeft: number;
	sceneTop: number;
	sceneWidth: number;
	sceneHeight: number;
	canvasWidth: number;
	canvasHeight: number;
	allowWithoutTextTrack?: boolean;
	renderTimeSeconds?: number;
}) {
	const editor = useEditor();
	const records = useEditor(
		(instance) =>
			instance.project.getActiveOrNull()?.capinstaCaptionDocuments ?? [],
	);
	const sceneTracks = useEditor(
		(instance) => instance.scenes.getActiveSceneOrNull()?.tracks,
	);
	const visibleRecords = useMemo(
		() =>
			sceneTracks
				? getVisibleCapinstaCaptionRecords({
						records,
						tracks: sceneTracks,
						includeHidden: allowWithoutTextTrack,
					})
				: records,
		[allowWithoutTextTrack, records, sceneTracks],
	);
	const hasTextTrack = useEditor((instance) => {
		if (allowWithoutTextTrack) {
			return (
				(instance.project.getActiveOrNull()?.capinstaCaptionDocuments?.length ??
					0) > 0
			);
		}
		// Tracks live on the active scene, not on the project. The previous code
		// read `project.getActive().tracks`, which never existed on TProject and
		// caused a TS error. We also check capinsta document count as a fast path.
		const activeProject = instance.project.getActiveOrNull();
		if (!activeProject) return false;
		const capinstaDocs = activeProject.capinstaCaptionDocuments ?? [];
		if (capinstaDocs.length === 0) return false;
		const tracks =
			instance.timeline.getPreviewTracks() ??
			instance.scenes.getActiveScene()?.tracks;
		if (!tracks) return false;
		const overlayTracks = tracks.overlay ?? [];
		return overlayTracks.some(
			(track) =>
				track.type === "text" &&
				!track.hidden &&
				track.elements.some((el) => el.type === "text"),
		);
	});
	const [currentTime, setCurrentTime] = useState<MediaTime>(() =>
		editor.playback.getCurrentTime(),
	);
	const [isPlaying, setIsPlaying] = useState(() =>
		editor.playback.getIsPlaying(),
	);
	const timingIndex = useMemo(
		() => createCapinstaCaptionTimingIndex({ records: visibleRecords }),
		[visibleRecords],
	);
	const lastOverlayUpdateRef = useRef({
		wallTime: 0,
		stateKey: "none",
	});

	useEffect(() => {
		if (renderTimeSeconds !== undefined) return;

		const update = (time: MediaTime) => {
			const playing = editor.playback.getIsPlaying();
			if (!playing) {
				lastOverlayUpdateRef.current = {
					wallTime: performance.now(),
					stateKey: "seek",
				};
				setCurrentTime(time);
				return;
			}

			const timeSeconds = mediaTimeToSeconds({ time });
			const activeState = getActiveCapinstaCaptionStateFromIndex({
				index: timingIndex,
				timeSeconds,
			});
			const stateKey = activeCapinstaCaptionStateKey(activeState);
			const now = performance.now();
			const last = lastOverlayUpdateRef.current;
			if (
				stateKey === last.stateKey &&
				now - last.wallTime < PLAYING_OVERLAY_MIN_UPDATE_MS
			) {
				return;
			}
			lastOverlayUpdateRef.current = { wallTime: now, stateKey };
			setCurrentTime(time);
		};
		const unsubscribeUpdate = editor.playback.onUpdate(update);
		const unsubscribeSeek = editor.playback.onSeek(update);
		const unsubscribePlayback = editor.playback.subscribe(() => {
			setIsPlaying(editor.playback.getIsPlaying());
			update(editor.playback.getCurrentTime());
		});
		return () => {
			unsubscribeUpdate();
			unsubscribeSeek();
			unsubscribePlayback();
		};
	}, [editor.playback, renderTimeSeconds, timingIndex]);

	const timeSeconds =
		renderTimeSeconds ?? mediaTimeToSeconds({ time: currentTime });
	const captionViewport = useMemo(
		() => ({ width: canvasWidth, height: canvasHeight }),
		[canvasWidth, canvasHeight],
	);
	const previewScale = useMemo(() => {
		if (canvasWidth <= 0 || canvasHeight <= 0) return 1;
		return Math.min(sceneWidth / canvasWidth, sceneHeight / canvasHeight);
	}, [canvasWidth, canvasHeight, sceneWidth, sceneHeight]);
	const captionPaperFold = useMemo(() => {
		const elements: TimelineElement[] =
			sceneTracks?.overlay.flatMap(
				(track) => track.elements as TimelineElement[],
			) ?? [];
		const element = elements.find(
			(candidate) =>
				candidate.type === "text" &&
				candidate.effects?.some(
					(effect) => effect.enabled && effect.type === "paper-fold",
				),
		);
		if (!element || element.type !== "text") return null;
		const effect = element.effects?.find(
			(candidate) => candidate.enabled && candidate.type === "paper-fold",
		);
		if (!effect) return null;
		const params = normalizePaperFoldParams(effect.params);
		const manifest = getPaperFoldManifest({ styleId: params.foldStyle });
		const localTimeSeconds = Math.max(
			0,
			timeSeconds - mediaTimeToSeconds({ time: element.startTime }),
		);
		const durationSeconds = mediaTimeToSeconds({ time: element.duration });
		return {
			params,
			state: resolvePaperFoldTiming({
				localTimeSeconds,
				durationSeconds,
				timelineFps: 30,
				frameCount: manifest.frameCount,
				params,
			}),
		};
	}, [sceneTracks, timeSeconds]);
	const activeState = useMemo(
		() =>
			getActiveCapinstaCaptionStateFromIndex({
				index: timingIndex,
				timeSeconds,
			}),
		[timingIndex, timeSeconds],
	);
	const renderModel = useMemo(
		() =>
			createCapinstaRenderModelFromIndex({
				index: timingIndex,
				timeSeconds,
				rendererPath: "rendered_capinsta_preview",
				viewport: captionViewport,
			}),
		[timingIndex, timeSeconds, captionViewport],
	);
	useEffect(() => {
		if (!activeState) return;
		const style = resolveCapinstaClipStyle({
			document: activeState.document,
			clip: activeState.clip,
		});
		void Promise.all(
			Array.from(
				new Set([
					style.text.fontFamily,
					style.lockup.bigFontFamily,
					style.lockup.smallFontFamily,
				]),
			).map((family) =>
				ensureCapinstaFontLoaded({
					family,
					weight: normalizeCapinstaFontWeight(style.text.fontWeight),
				}),
			),
		).catch((error) => {
			console.warn("[capinsta-preview] caption font unavailable", {
				fontFamily: style.text.fontFamily,
				error: error instanceof Error ? error.message : String(error),
			});
		});
	}, [activeState]);

	// Compute and expose a preview style hash so it can be compared against the
	// export style hash (__EXPORT_STYLE_HASH__) for parity validation.
	useEffect(() => {
		if (typeof window === "undefined" || !activeState) return;
		try {
			const style = resolveCapinstaClipStyle({
				document: activeState.document,
				clip: activeState.clip,
			});
			window.__PREVIEW_STYLE_HASH__ = computeCaptionStyleHash(style);
			window.__PREVIEW_STYLE_INFO__ = summarizeCaptionStyle(style);
			// Also resolve + log layout for parity with the export page
			// (__EXPORT_LAYOUT_INFO__ / __EXPORT_LAYOUT_HASH__). Both paths now
			// call the same shared utility, so values must match.
			try {
				const resolved = resolveCapinstaCaptionLayout(
					style,
					canvasWidth,
					canvasHeight,
				);
				window.__PREVIEW_LAYOUT_INFO__ = summarizeCaptionLayout(resolved);
				window.__PREVIEW_LAYOUT_HASH__ = computeCaptionLayoutHash(resolved);
			} catch {
				// Non-fatal: layout diagnostics only.
			}
		} catch {
			// Non-fatal: style hash is for diagnostics only.
		}
	}, [activeState, canvasWidth, canvasHeight]);

	useEffect(() => {
		if (process.env.NEXT_PUBLIC_CAPINSTA_DEBUG !== "true") return;
		console.debug("[capinsta-preview] timing index", {
			recordCount: visibleRecords.length,
			clipCount: timingIndex.clipCount,
			wordCount: timingIndex.wordCount,
		});
	}, [timingIndex, visibleRecords.length]);

	useEffect(() => {
		if (
			!renderModel ||
			process.env.NEXT_PUBLIC_CAPINSTA_DEBUG !== "true" ||
			typeof window === "undefined"
		) {
			return;
		}
		window.__CAPINSTA_LAST_PREVIEW_MANIFEST = renderModel.manifest;
		window.__CAPINSTA_LAST_EXPORT_PREVIEW_MANIFEST = renderModel.manifest;
		window.__CAPINSTA_LAST_EXPORT_MANIFEST = renderModel.manifest;
		console.info("rendered_capinsta_preview", renderModel.manifest);
	}, [renderModel]);

	// FIX 6: Debug logging for active caption state on every render
	useEffect(() => {
		if (process.env.NEXT_PUBLIC_CAPINSTA_DEBUG !== "true") return;
		if (!activeState) return;
		console.debug("[capinsta-overlay] active caption render", {
			text: activeState.clip.text,
			clipId: activeState.clip.id,
			presetId:
				activeState.clip.stylePresetId ??
				activeState.document.stylePresetId ??
				"none",
			activeWordCount: activeState.activeWordIds.length,
			timeSeconds,
		});
	}, [activeState, timeSeconds]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		if (renderTimeSeconds !== undefined) return;
		if (activeState) {
			window.__CAPSTA_ACTIVE_FRAME_INFO__ = {
				activeCaptionId: activeState.clip.id,
				activeWordId: activeState.activeWordIds[0] || "none",
				captionText: activeState.clip.text,
			};
		} else {
			window.__CAPSTA_ACTIVE_FRAME_INFO__ = {
				activeCaptionId: "none",
				activeWordId: "none",
				captionText: "",
			};
		}
	}, [activeState, renderTimeSeconds]);

	if (!activeState || !renderModel || !hasTextTrack) return null;

	return (
		<div
			data-capinsta-caption-renderer="react-overlay-only"
			className="absolute overflow-hidden pointer-events-none"
			style={{
				left: sceneLeft,
				top: sceneTop,
				width: sceneWidth,
				height: sceneHeight,
				zIndex: 12,
			}}
		>
			<div
				className="relative pointer-events-none"
				style={{
					width: canvasWidth,
					height: canvasHeight,
					transform: `scale(${previewScale})`,
					transformOrigin: "top left",
				}}
			>
				<div
					className="relative size-full"
					style={captionPaperFoldStyle(captionPaperFold)}
				>
					<CapinstaCaptionRenderer
						renderModel={renderModel}
						activeWordIds={activeState.activeWordIds}
						timeSeconds={timeSeconds}
						isPlaying={renderTimeSeconds !== undefined ? true : isPlaying}
						viewport={captionViewport}
					/>
					{captionPaperFold && captionPaperFold.state.progress < 0.999 ? (
						<div
							aria-hidden
							className="absolute inset-y-0 left-1/2 pointer-events-none"
							style={{
								width: `${Math.max(1, (1 - captionPaperFold.state.progress) * 18)}%`,
								transform: "translateX(-50%)",
								background: `linear-gradient(90deg, transparent, ${captionPaperFold.params.paperColor}, transparent)`,
								opacity:
									captionPaperFold.params.paperOpacity *
									captionPaperFold.params.paperTintAmount,
							}}
						/>
					) : null}
				</div>
			</div>
		</div>
	);
}

function captionPaperFoldStyle(
	runtime: {
		params: PaperFoldParams;
		state: {
			progress: number;
			offsetX: number;
			offsetY: number;
			rotationDegrees: number;
		};
	} | null,
): CSSProperties | undefined {
	if (!runtime) return undefined;
	const { params, state } = runtime;
	const foldedEdge = (1 - state.progress) * 50;
	const clipPath =
		params.foldDirection === "left"
			? `inset(0 ${foldedEdge}% 0 0)`
			: params.foldDirection === "up"
				? `inset(0 0 ${foldedEdge}% 0)`
				: params.foldDirection === "down"
					? `inset(${foldedEdge}% 0 0 0)`
					: `inset(0 0 0 ${foldedEdge}%)`;
	return {
		clipPath,
		opacity: params.overallOpacity,
		transform: `translate(${params.positionX + state.offsetX}px, ${params.positionY + state.offsetY}px) rotate(${params.rotation + state.rotationDegrees}deg) scale(${params.scale})`,
		transformOrigin: params.foldOrigin.replace("-", " "),
		filter: `drop-shadow(${params.shadowEnabled ? params.shadowDistance : 0}px ${params.shadowEnabled ? params.shadowDistance : 0}px ${params.shadowEnabled ? params.shadowBlur : 0}px ${params.shadowColor})`,
	};
}
