/* CaptionOverlay - frame-aware caption preview */

"use client";

import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import CaptionRenderer from "@/components/captions/CaptionRenderer";
import { captionBelongsOnTrack, isCaptionLocked } from "@/lib/editorModel";
import { useCaptionStore } from "@/store/captionStore";
import { useEditorStore } from "@/store/editorStore";
import { usePlaybackStore } from "@/store/playbackStore";
import { useTimelineStore } from "@/store/timelineStore";

export default function CaptionOverlay() {
  const currentTime = usePlaybackStore((s) => s.currentTime);
  const showOverlay = usePlaybackStore((s) => s.showCaptionOverlay);
  const captions = useCaptionStore((s) => s.captions);
  const selectedIds = useCaptionStore((s) => s.selectedIds);
  const captionStyleConfig = useEditorStore((s) => s.captionStyleConfig);
  const sequenceSettings = useEditorStore((s) => s.sequenceSettings);
  const sequenceFps = useEditorStore((s) => s.sequenceSettings.fps);
  const globalOffsetSeconds = useEditorStore((s) => s.captionTimingConfig.globalOffsetSeconds);
  const setCaptionLayerTransform = useEditorStore((s) => s.setCaptionLayerTransform);
  const tracks = useTimelineStore((s) => s.tracks);
  const captionVisible = tracks.some((track) =>
    (track.type === "caption" || track.type === "overlay") &&
    track.visible &&
    captions.some((caption) => captionBelongsOnTrack(caption, track, tracks))
  );
  const locked = captions.some(
    (caption) => (selectedIds.size === 0 || selectedIds.has(caption.id)) && isCaptionLocked(caption, tracks)
  );
  const draggingRef = useRef(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [overlaySize, setOverlaySize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = overlayRef.current;
    if (!element) return;

    const updateSize = () => {
      setOverlaySize({ width: element.clientWidth, height: element.clientHeight });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const frameTime = useMemo(() => {
    const fps = Math.max(1, Number(sequenceFps) || 30);
    const frame = Math.max(0, Math.floor(currentTime * fps + 1e-6));
    return frame / fps + globalOffsetSeconds;
  }, [currentTime, globalOffsetSeconds, sequenceFps]);

  const previewScale = useMemo(() => {
    const sequenceWidth = Math.max(1, sequenceSettings.width);
    const sequenceHeight = Math.max(1, sequenceSettings.height);
    if (overlaySize.width <= 0 || overlaySize.height <= 0) return 1;
    const fitScale = Math.min(overlaySize.width / sequenceWidth, overlaySize.height / sequenceHeight);
    return Math.max(0.05, Math.min(3, fitScale));
  }, [overlaySize.height, overlaySize.width, sequenceSettings.height, sequenceSettings.width]);

  const activeCaption = useMemo(
    () =>
      captions
        .filter((caption) => frameTime >= caption.start && frameTime < caption.end)
        .sort((a, b) => b.start - a.start || a.end - b.end)[0] || null,
    [captions, frameTime]
  );

  const updatePositionFromPointer = useCallback(
    (event: PointerEvent | React.PointerEvent<HTMLDivElement>, element: HTMLDivElement) => {
      const rect = element.getBoundingClientRect();
      const xPercent = ((event.clientX - rect.left) / rect.width) * 100;
      const yPercent = ((event.clientY - rect.top) / rect.height) * 100;
      setCaptionLayerTransform({ xPercent, yPercent });
    },
    [setCaptionLayerTransform]
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (captions.length === 0 || locked) return;
      draggingRef.current = true;
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      updatePositionFromPointer(event, target);

      const handleMove = (moveEvent: PointerEvent) => {
        if (draggingRef.current) updatePositionFromPointer(moveEvent, target);
      };
      const handleUp = () => {
        draggingRef.current = false;
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [captions.length, locked, updatePositionFromPointer]
  );

  if (!showOverlay || !captionVisible || !activeCaption) return null;
  const previewReady = overlaySize.width > 0 && overlaySize.height > 0;
  const effectivePreviewScale = previewReady ? previewScale : 0.25;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0"
      style={{
        cursor: locked ? "not-allowed" : captions.length ? "grab" : "default",
        minWidth: 1,
        minHeight: 1,
      }}
      title={locked ? "Caption track locked" : "Drag to move the global caption layer"}
      onPointerDown={handlePointerDown}
    >
      <CaptionRenderer
        captions={[activeCaption]}
        currentTime={frameTime}
        fps={sequenceFps}
        scale={effectivePreviewScale}
        transition
        styleConfig={captionStyleConfig}
        canvasSize={{ width: sequenceSettings.width, height: sequenceSettings.height }}
      />
    </div>
  );
}
