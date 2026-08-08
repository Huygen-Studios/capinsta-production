/* Timeline — main timeline panel with ruler, tracks, playhead */

"use client";

import React, { useRef, useCallback, useEffect, useMemo, useState } from "react";
import { Magnet, Maximize2, Plus, ZoomIn, ZoomOut, Trash2 } from "lucide-react";
import { useTimelineStore } from "@/store/timelineStore";
import { useCaptionStore } from "@/store/captionStore";
import { usePlaybackStore } from "@/store/playbackStore";
import { useEditorStore } from "@/store/editorStore";
import { useTimelineSync } from "@/hooks/useTimelineSync";
import { TRACK_HEADER_WIDTH } from "@/lib/timelineUtils";
import TimelineRuler from "./TimelineRuler";
import TimelineTrack from "./TimelineTrack";
import Playhead from "./Playhead";

export default function Timeline() {
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    tracks,
    scrollLeft,
    pixelsPerSecond,
    setPixelsPerSecond,
    setScrollLeft,
    setTimelineView,
    snapEnabled,
    toggleSnap,
    zoomIn,
    zoomOut,
    fitZoom,
    addTrackByType,
    notice,
    clearNotice,
  } = useTimelineStore();

  const clearAll = useCaptionStore((s) => s.clearAll);
  const duration = usePlaybackStore((s) => s.duration);
  const mediaFiles = useEditorStore((s) => s.mediaFiles);
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);
  const [containerWidth, setContainerWidth] = useState(900);
  const wheelFrameRef = useRef<number | null>(null);
  const pendingViewRef = useRef<{ pixelsPerSecond: number; scrollLeft: number } | null>(null);

  const { handleTimelineSeek } = useTimelineSync();

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setContainerWidth(element.clientWidth || 900);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(clearNotice, 3200);
    return () => window.clearTimeout(timer);
  }, [clearNotice, notice]);

  const projectDuration = useMemo(
    () =>
      Math.max(
        30,
        duration,
        ...tracks.flatMap((track) => (track.clips || []).map((clip) => clip.end))
      ),
    [duration, tracks]
  );
  const contentViewportWidth = Math.max(1, containerWidth - TRACK_HEADER_WIDTH);
  const maxScrollLeft = Math.max(0, projectDuration * pixelsPerSecond - contentViewportWidth);

  useEffect(() => {
    if (scrollLeft > maxScrollLeft) setScrollLeft(maxScrollLeft);
  }, [maxScrollLeft, scrollLeft, setScrollLeft]);

  const commitTimelineView = useCallback(
    (nextPixelsPerSecond: number, nextScrollLeft: number) => {
      pendingViewRef.current = { pixelsPerSecond: nextPixelsPerSecond, scrollLeft: nextScrollLeft };
      if (wheelFrameRef.current !== null) return;
      wheelFrameRef.current = window.requestAnimationFrame(() => {
        wheelFrameRef.current = null;
        const pending = pendingViewRef.current;
        pendingViewRef.current = null;
        if (!pending) return;
        setTimelineView(pending.pixelsPerSecond, pending.scrollLeft);
      });
    },
    [setTimelineView]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      const element = containerRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const mouseX = Math.max(0, Math.min(contentViewportWidth, e.clientX - rect.left - TRACK_HEADER_WIDTH));

      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const oldPixelsPerSecond = useTimelineStore.getState().pixelsPerSecond;
        const oldScrollLeft = useTimelineStore.getState().scrollLeft;
        const factor = Math.exp(-e.deltaY * 0.002);
        const nextPixelsPerSecond = Math.max(5, Math.min(220, oldPixelsPerSecond * factor));
        const timeUnderCursor = (oldScrollLeft + mouseX) / oldPixelsPerSecond;
        const nextMaxScrollLeft = Math.max(0, projectDuration * nextPixelsPerSecond - contentViewportWidth);
        const nextScrollLeft = Math.max(0, Math.min(nextMaxScrollLeft, timeUnderCursor * nextPixelsPerSecond - mouseX));
        commitTimelineView(nextPixelsPerSecond, nextScrollLeft);
        return;
      }

      e.preventDefault();
      const currentScrollLeft = useTimelineStore.getState().scrollLeft;
      const panDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      setScrollLeft(Math.max(0, Math.min(maxScrollLeft, currentScrollLeft + panDelta)));
    },
    [commitTimelineView, contentViewportWidth, maxScrollLeft, projectDuration, setScrollLeft]
  );

  // Click on ruler area to seek
  const handleRulerClick = useCallback(
    (e: React.MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      handleTimelineSeek(e.clientX, rect.left);
    },
    [handleTimelineSeek]
  );

  const hasTimelineClips = tracks.some((track) => (track.clips || []).length > 0);
  const hasImportedMedia = mediaFiles.length > 0;
  const zoomPercent = Math.round((pixelsPerSecond / 40) * 100);

  return (
    <div className="panel flex flex-col h-full">
      {/* Timeline header */}
      <div className="panel-header justify-between">
        <span>Timeline</span>
        <div className="flex items-center gap-1">
          <button
            className="p-1 rounded hover:bg-[var(--hover-surface)]"
            onClick={toggleSnap}
            title={`Snap ${snapEnabled ? "ON" : "OFF"}`}
          >
            <Magnet
              size={12}
              style={{ color: snapEnabled ? "var(--accent)" : "var(--text-muted)" }}
            />
          </button>
          <button className="p-1 rounded hover:bg-[var(--hover-surface)]" onClick={zoomOut} title="Zoom Out (-)">
            <ZoomOut size={12} style={{ color: "var(--text-muted)" }} />
          </button>
          <input
            type="range"
            min={5}
            max={220}
            step={1}
            value={Math.round(pixelsPerSecond)}
            onChange={(event) => setPixelsPerSecond(Number(event.target.value))}
            className="timeline-zoom-slider"
            aria-label="Timeline zoom"
          />
          <span className="timeline-zoom-readout">{zoomPercent}%</span>
          <button className="p-1 rounded hover:bg-[var(--hover-surface)]" onClick={zoomIn} title="Zoom In (+)">
            <ZoomIn size={12} style={{ color: "var(--text-muted)" }} />
          </button>
          <button className="p-1 rounded hover:bg-[var(--hover-surface)]" onClick={() => fitZoom(projectDuration, contentViewportWidth)} title="Fit timeline">
            <Maximize2 size={12} style={{ color: "var(--text-muted)" }} />
          </button>
          <button
            className="p-1 rounded hover:bg-[var(--hover-surface)]"
            onClick={clearAll}
            title="Clear All Captions"
          >
            <Trash2 size={12} style={{ color: "var(--text-muted)" }} />
          </button>
          <div className="relative">
            <button
              className="btn-ghost flex items-center gap-1 px-2 py-1 text-[10px]"
              onClick={() => setLayerMenuOpen((open) => !open)}
              title="Add timeline layer"
            >
              <Plus size={12} />
              Layer
            </button>
            {layerMenuOpen && (
              <div className="menu-popover absolute right-0 top-7 z-[90] w-40 p-1">
                {[
                  ["video", "Add Video Layer"],
                  ["audio", "Add Audio Layer"],
                  ["caption", "Add Subtitle Layer"],
                  ["overlay", "Add Overlay Layer"],
                ].map(([type, label]) => (
                  <button
                    key={type}
                    className="menu-item text-[11px]"
                    onClick={() => {
                      addTrackByType(type as "video" | "audio" | "caption" | "overlay");
                      setLayerMenuOpen(false);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {notice && (
        <div className="editor-notice mx-2 mt-2 flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button className="text-xs font-bold" onClick={clearNotice}>
            Dismiss
          </button>
        </div>
      )}

      {/* Timeline body */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-y-auto overflow-x-hidden"
        onWheel={handleWheel}
        data-timeline-area
      >
        {/* Ruler row */}
        <div className="sticky top-0 z-40 flex">
          {/* Track header spacer */}
          <div
            className="shrink-0"
            style={{
              width: TRACK_HEADER_WIDTH,
              background: "var(--bg-sidebar)",
              borderRight: "1px solid var(--border)",
              borderBottom: "1px solid var(--border)",
              height: 24,
            }}
          />
          {/* Ruler */}
          <div className="flex-1 overflow-hidden cursor-pointer" onClick={handleRulerClick}>
            <TimelineRuler width={contentViewportWidth} />
          </div>
        </div>

        {/* Tracks */}
        <div className="relative min-h-full">
          {tracks.map((track) => (
            <TimelineTrack key={track.id} track={track} />
          ))}

          {/* Playhead spans all tracks */}
          <Playhead />

          {/* Empty state */}
          {!hasTimelineClips && !hasImportedMedia && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center py-8">
              <p className="brutal-empty px-4 py-3 text-xs" style={{ color: "var(--text-muted)" }}>
                Your video and captions will appear here.
              </p>
            </div>
          )}
        </div>
      </div>

      <div
        className="h-4 px-2 flex items-center"
        style={{ background: "var(--bg-monitor-controls)", borderTop: "1px solid var(--border)" }}
      >
        <input
          type="range"
          min={0}
          max={Math.max(0, Math.round(maxScrollLeft))}
          value={Math.min(scrollLeft, maxScrollLeft)}
          onChange={(event) => setScrollLeft(Number(event.target.value))}
          className="w-full"
          aria-label="Timeline horizontal scroll"
        />
      </div>
    </div>
  );
}
