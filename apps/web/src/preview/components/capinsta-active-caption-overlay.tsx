"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "@/editor/use-editor";
import { mediaTimeToSeconds, type MediaTime } from "@/wasm";
import { CapinstaCaptionRenderer } from "@/capinsta/render/CapinstaCaptionRenderer";
import {
	activeCapinstaCaptionStateKey,
	createCapinstaCaptionTimingIndex,
	getActiveCapinstaCaptionStateFromIndex,
} from "@/capinsta/captionTimingIndex";
import { createCapinstaRenderModelFromIndex } from "@/capinsta/render/capinstaRenderModel";

declare global {
	interface Window {
		__CAPINSTA_LAST_PREVIEW_MANIFEST?: unknown;
		__CAPINSTA_LAST_EXPORT_PREVIEW_MANIFEST?: unknown;
		__CAPINSTA_LAST_EXPORT_MANIFEST?: unknown;
	}
}

const PLAYING_OVERLAY_MIN_UPDATE_MS = 90;

export function CapinstaActiveCaptionOverlay({
	sceneLeft,
	sceneTop,
	sceneWidth,
	sceneHeight,
	canvasWidth,
	canvasHeight,
}: {
	sceneLeft: number;
	sceneTop: number;
	sceneWidth: number;
	sceneHeight: number;
	canvasWidth: number;
	canvasHeight: number;
}) {
	const editor = useEditor();
	const records = useEditor(
		(instance) =>
			instance.project.getActive()?.capinstaCaptionDocuments ?? [],
	);
	const hasTextTrack = useEditor((instance) => {
		const tracks = instance.project.getActive()?.tracks ?? [];
		return tracks.some((track) => track.elements.some((el) => el.type === "text"));
	});
	const [currentTime, setCurrentTime] = useState<MediaTime>(() =>
		editor.playback.getCurrentTime(),
	);
	const [isPlaying, setIsPlaying] = useState(() =>
		editor.playback.getIsPlaying(),
	);
	const timingIndex = useMemo(
		() => createCapinstaCaptionTimingIndex({ records }),
		[records],
	);
	const lastOverlayUpdateRef = useRef({
		wallTime: 0,
		stateKey: "none",
	});

	useEffect(() => {
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
	}, [editor.playback, timingIndex]);

	const timeSeconds = mediaTimeToSeconds({ time: currentTime });
	const captionViewport = useMemo(
		() => ({ width: canvasWidth, height: canvasHeight }),
		[canvasWidth, canvasHeight],
	);
	const previewScale = useMemo(() => {
		if (canvasWidth <= 0 || canvasHeight <= 0) return 1;
		return Math.min(sceneWidth / canvasWidth, sceneHeight / canvasHeight);
	}, [canvasWidth, canvasHeight, sceneWidth, sceneHeight]);
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
		if (process.env.NEXT_PUBLIC_CAPINSTA_DEBUG !== "true") return;
		console.debug("[capinsta-preview] timing index", {
			recordCount: records.length,
			clipCount: timingIndex.clipCount,
			wordCount: timingIndex.wordCount,
		});
	}, [records.length, timingIndex]);

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

	if (!activeState || !renderModel || !hasTextTrack) return null;

	return (
		<div
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
				<CapinstaCaptionRenderer
					renderModel={renderModel}
					activeWordIds={activeState.activeWordIds}
					timeSeconds={timeSeconds}
					isPlaying={isPlaying}
					viewport={captionViewport}
				/>
			</div>
		</div>
	);
}
