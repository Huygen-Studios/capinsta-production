/* ProgramMonitor - Premiere-style composition preview */

/* eslint-disable @next/next/no-img-element */

"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Grid3X3, Pause, Play, SkipBack, SkipForward, Square } from "lucide-react";
import { normalizeClipTransform } from "@/lib/editorModel";
import { formatTimecode } from "@/lib/captionUtils";
import { useEditorStore } from "@/store/editorStore";
import { useCaptionStore } from "@/store/captionStore";
import { usePlaybackStore } from "@/store/playbackStore";
import { useTimelineStore } from "@/store/timelineStore";
import { useVideoPlayer } from "@/hooks/useVideoPlayer";
import CaptionOverlay from "./CaptionOverlay";

export default function ProgramMonitor({ chrome = "full" }: { chrome?: "full" | "preview-only" }) {
  const {
    isPlaying,
    currentTime,
    duration,
    zoom,
    quality,
    showSafeZone,
    showCaptionOverlay,
    togglePlayPause,
    stop,
    setZoom,
    setQuality,
    toggleSafeZone,
    toggleCaptionOverlay,
  } = usePlaybackStore();
  const { mediaFiles, activeTool, sequenceSettings } = useEditorStore();
  const tracks = useTimelineStore((s) => s.tracks);
  const setTimelineNotice = useTimelineStore((s) => s.setNotice);
  const captionCount = useCaptionStore((s) => s.captions.length);
  const captionsVisible = useTimelineStore((s) => s.tracks.some((track) => (track.type === "caption" || track.type === "overlay") && track.visible));
  const { attachVideo, frameForward, frameBack } = useVideoPlayer();

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const panRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const updateViewport = () => {
      setViewportSize({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    };

    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const activeVisualLayers = useMemo(() => {
    return tracks
      .filter((track) => track.visible && (track.type === "video" || track.type === "overlay" || track.type === "image"))
      .flatMap((track) => (track.clips || []).map((clip) => ({ clip, track })))
      .filter(({ clip }) => clip.visible !== false && clip.type !== "audio" && currentTime >= clip.start && currentTime <= clip.end)
      .sort((a, b) => (a.track.zIndex || 0) - (b.track.zIndex || 0));
  }, [currentTime, tracks]);

  const firstVideoLayerId = activeVisualLayers.find(({ clip }) => clip.type === "video")?.clip.id;
  const hasPlayableVideo = tracks.some((track) => track.visible && (track.clips || []).some((clip) => clip.type === "video" && clip.visible !== false));
  const audioEnabled = useMemo(
    () =>
      tracks.some((track) =>
        track.type === "audio" &&
        track.visible &&
        !track.muted &&
        (track.clips || []).some((clip) => clip.visible !== false && !clip.muted && currentTime >= clip.start && currentTime <= clip.end)
      ),
    [currentTime, tracks]
  );
  const hasVisibleComposition = activeVisualLayers.length > 0 || (showCaptionOverlay && captionsVisible && captionCount > 0);
  const hasImportedVideo = mediaFiles.some((file) => file.type === "video");

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      const nextZoom = Math.max(25, Math.min(200, zoom + (event.deltaY < 0 ? 25 : -25)));
      setZoom(nextZoom);
      if (nextZoom <= 100) setPan({ x: 0, y: 0 });
    },
    [setZoom, zoom]
  );

  const handlePanDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (zoom <= 100 && activeTool !== "hand") return;
      panRef.current = { ...pan, startX: event.clientX, startY: event.clientY };

      const onMove = (moveEvent: MouseEvent) => {
        if (!panRef.current) return;
        setPan({
          x: panRef.current.x + moveEvent.clientX - panRef.current.startX,
          y: panRef.current.y + moveEvent.clientY - panRef.current.startY,
        });
      };

      const onUp = () => {
        panRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [activeTool, pan, zoom]
  );

  const compositionFit = useMemo(() => {
    const sequenceWidth = Math.max(1, sequenceSettings.width);
    const sequenceHeight = Math.max(1, sequenceSettings.height);
    const viewportWidth = Math.max(1, viewportSize.width);
    const viewportHeight = Math.max(1, viewportSize.height);
    const sequenceAspect = sequenceWidth / sequenceHeight;
    const viewportAspect = viewportWidth / viewportHeight;

    if (viewportAspect > sequenceAspect) {
      const height = viewportHeight;
      return { width: height * sequenceAspect, height };
    }

    const width = viewportWidth;
    return { width, height: width / sequenceAspect };
  }, [sequenceSettings.height, sequenceSettings.width, viewportSize.height, viewportSize.width]);

  const compositionAspect = `${sequenceSettings.width} / ${sequenceSettings.height}`;
  const safeMargin = sequenceSettings.safeMarginsEnabled
    ? sequenceSettings.safeMarginsPercent ?? sequenceSettings.safeMargins ?? 8
    : 0;

  return (
    <div className={`panel flex h-full flex-col ${chrome === "preview-only" ? "program-monitor-preview-only" : ""}`}>
      {chrome === "full" && (
        <div className="panel-header">
          <span>Program</span>
        </div>
      )}

      <div
        ref={viewportRef}
        className="relative flex flex-1 items-center justify-center overflow-hidden p-3"
        style={{ background: "var(--bg-program)" }}
        onWheel={handleWheel}
        onMouseDown={handlePanDown}
      >
        {!hasVisibleComposition && !hasImportedVideo && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-6 text-center">
            <div className="brutal-empty max-w-sm px-8 py-6">
              <img
                className="empty-logo mx-auto"
                src="/brand/huygen-logo.png"
                alt="Huygen Caps"
                width={96}
                height={73}
                style={{ width: 96, maxWidth: 96, height: "auto", objectFit: "contain" }}
              />
              <div className="mb-1 text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                Import a video to start captioning.
              </div>
              <div className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                Your preview, subtitles, and export settings will light up after import.
              </div>
            </div>
          </div>
        )}

        <div
          className="relative max-h-full max-w-full overflow-visible"
          style={{
            aspectRatio: compositionAspect,
            width: `${compositionFit.width}px`,
            height: `${compositionFit.height}px`,
            maxWidth: "100%",
            maxHeight: "100%",
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom / 100})`,
            transformOrigin: "center center",
            cursor: zoom > 100 || activeTool === "hand" ? "grab" : "default",
          }}
        >
          <div
            className="absolute inset-0 overflow-hidden"
            style={{ background: sequenceSettings.backgroundColor }}
          >
            {activeVisualLayers.map(({ clip, track }) => {
              const media = mediaFiles.find((file) => file.id === clip.mediaId);
              if (!media) return null;
              const transform = normalizeClipTransform(clip.transform);
              const commonStyle: React.CSSProperties = {
                zIndex: track.zIndex || 0,
                opacity: transform.opacity,
                left: `${transform.xPercent}%`,
                top: `${transform.yPercent}%`,
                transform: `translate(-50%, -50%) scale(${transform.scale}) rotate(${transform.rotation}deg)`,
                transformOrigin: "center center",
              };

              if (clip.type === "video" && media.type === "video") {
                return (
                  <div key={clip.id} className="absolute h-full w-full" style={commonStyle}>
                    <video
                      ref={clip.id === firstVideoLayerId ? attachVideo : undefined}
                      src={media.url}
                      muted={!audioEnabled}
                      className="h-full w-full object-contain"
                      style={{ imageRendering: quality === "quarter" ? "pixelated" : "auto" }}
                    />
                  </div>
                );
              }

              if (clip.type === "image" && media.type === "image") {
                return (
                  <img
                    key={clip.id}
                    src={media.url}
                    alt={media.name}
                    className="absolute max-h-[70%] max-w-[70%] pointer-events-none"
                    style={commonStyle}
                  />
                );
              }

              return null;
            })}

            {showSafeZone && (
              <div className="absolute inset-0 z-40 pointer-events-none">
                <div
                  className="absolute border border-dashed"
                  style={{
                    top: `${safeMargin}%`,
                    left: `${safeMargin}%`,
                    right: `${safeMargin}%`,
                    bottom: `${safeMargin}%`,
                    borderColor: "var(--accent)",
                  }}
                />
                <div
                  className="absolute border border-dashed"
                  style={{ top: "4%", left: "4%", right: "4%", bottom: "4%", borderColor: "var(--huygen-red)" }}
                />
              </div>
            )}

            <div className="absolute inset-0" style={{ zIndex: 80 }}>
              <CaptionOverlay />
            </div>

            {!hasVisibleComposition && hasImportedVideo && (
              <div className="absolute inset-0 flex items-center justify-center text-center">
                <div className="brutal-empty px-8 py-6">
                  <img
                    className="empty-logo mx-auto"
                    src="/brand/huygen-logo.png"
                    alt="Huygen Caps"
                    width={96}
                    height={73}
                    style={{ width: 96, maxWidth: 96, height: "auto", objectFit: "contain" }}
                  />
                  <div className="text-sm mb-1" style={{ color: "var(--text-muted)" }}>
                    Move the playhead over the imported clip.
                  </div>
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Generate captions to edit subtitle timing.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {chrome === "full" && (
        <div
          className="flex shrink-0 items-center gap-1 px-3 py-1.5"
          style={{ background: "var(--bg-monitor-controls)", borderTop: "1px solid var(--border)" }}
        >
        <button className="p-1 rounded hover:bg-[var(--hover-surface)]" onClick={stop} title="Stop">
          <Square size={14} style={{ color: "var(--text-muted)" }} />
        </button>
        <button className="p-1 rounded hover:bg-[var(--hover-surface)]" onClick={frameBack} title="Frame Back">
          <SkipBack size={14} style={{ color: "var(--text-muted)" }} />
        </button>
        <button
          className="p-1.5 rounded hover:bg-[var(--hover-surface)]"
          onClick={() => {
            if (!hasPlayableVideo) {
              setTimelineNotice("Import a video before playback.");
              return;
            }
            togglePlayPause();
          }}
          title="Play/Pause"
        >
          {isPlaying ? <Pause size={18} style={{ color: "var(--text-primary)" }} /> : <Play size={18} style={{ color: "var(--text-primary)" }} />}
        </button>
        <button className="p-1 rounded hover:bg-[var(--hover-surface)]" onClick={frameForward} title="Frame Forward">
          <SkipForward size={14} style={{ color: "var(--text-muted)" }} />
        </button>

        <div className="ml-2 rounded px-2 py-0.5 font-mono text-xs" style={{ background: "var(--timecode-bg)", color: "var(--timecode-text)" }}>
          {formatTimecode(currentTime)}
        </div>
        <span className="mx-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
          /
        </span>
        <div className="rounded px-2 py-0.5 font-mono text-xs" style={{ background: "var(--timecode-bg)", color: "var(--timecode-muted)" }}>
          {formatTimecode(duration)}
        </div>

        <div className="flex-1" />

        <button className="p-1 rounded hover:bg-[var(--hover-surface)]" onClick={toggleCaptionOverlay} title="Toggle Captions">
          {showCaptionOverlay ? <Eye size={14} style={{ color: "var(--accent)" }} /> : <EyeOff size={14} style={{ color: "var(--text-muted)" }} />}
        </button>
        <button className="p-1 rounded hover:bg-[var(--hover-surface)]" onClick={toggleSafeZone} title="Toggle Safe Zone">
          <Grid3X3 size={14} style={{ color: showSafeZone ? "var(--accent)" : "var(--text-muted)" }} />
        </button>

        <select
          className="rounded border-0 px-1 py-0.5 text-[10px] outline-none"
          style={{ background: "var(--bg-control)", color: "var(--text-muted)", border: "1px solid var(--border)" }}
          value={zoom}
          onChange={(event) => {
            const nextZoom = Number(event.target.value);
            setZoom(nextZoom);
            if (nextZoom <= 100) setPan({ x: 0, y: 0 });
          }}
        >
          <option value={25}>25%</option>
          <option value={50}>50%</option>
          <option value={100}>Fit</option>
          <option value={125}>Fill</option>
          <option value={200}>200%</option>
        </select>

        <select
          className="rounded border-0 px-1 py-0.5 text-[10px] outline-none"
          style={{ background: "var(--bg-control)", color: "var(--text-muted)", border: "1px solid var(--border)" }}
          value={quality}
          onChange={(event) => setQuality(event.target.value as "full" | "half" | "quarter")}
        >
          <option value="full">Full</option>
          <option value="half">1/2</option>
          <option value="quarter">1/4</option>
        </select>
        </div>
      )}
    </div>
  );
}
