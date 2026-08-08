/* TimelineTrack - track header, drops, and clip rendering */

"use client";

import React, { useCallback, useMemo, useRef } from "react";
import { Eye, EyeOff, Lock, Unlock, Volume2, VolumeX } from "lucide-react";
import { TimelineClip, TimelineTrack as TrackType } from "@/lib/types";
import { useCaptionStore } from "@/store/captionStore";
import { useEditorStore } from "@/store/editorStore";
import { usePlaybackStore } from "@/store/playbackStore";
import { useTimelineStore } from "@/store/timelineStore";
import { canDropOnTrack, captionBelongsOnTrack, getDropRejectReason } from "@/lib/editorModel";
import { pixelToTime, timeToPixel, TRACK_HEADER_WIDTH } from "@/lib/timelineUtils";
import CaptionBlock from "./CaptionBlock";
import WaveformTrack from "./WaveformTrack";

interface Props {
  track: TrackType;
}

function clipColor(type: TimelineClip["type"]) {
  if (type === "video") return "var(--clip-video)";
  if (type === "audio") return "var(--clip-audio)";
  if (type === "image") return "var(--clip-image)";
  return "var(--clip-caption)";
}

function MediaClipBlock({ clip, track }: { clip: TimelineClip; track: TrackType }) {
  const { pixelsPerSecond, scrollLeft, updateClip, moveClipToTrack, selectClip, selectedClipIds, tracks, setNotice } = useTimelineStore();
  const mediaFiles = useEditorStore((s) => s.mediaFiles);
  const setRightPanelTab = useEditorStore((s) => s.setRightPanelTab);
  const media = mediaFiles.find((file) => file.id === clip.mediaId);
  const dragRef = useRef<{ startX: number; origStart: number; origEnd: number } | null>(null);
  const trimRef = useRef<{ edge: "start" | "end"; startX: number; origStart: number; origEnd: number } | null>(null);
  const lastPointerRef = useRef({ x: 0, y: 0 });

  const left = timeToPixel(clip.start, pixelsPerSecond, scrollLeft);
  const width = Math.max(24, (clip.end - clip.start) * pixelsPerSecond);
  const visibleLeft = Math.max(0, left);
  const visibleWidth = Math.max(10, width - Math.max(0, -left));
  const selected = selectedClipIds.includes(clip.id);

  const onMouseDown = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      selectClip(clip.id, event.ctrlKey || event.metaKey);
      setRightPanelTab("effect-controls");
      if (track.locked) return;
      dragRef.current = { startX: event.clientX, origStart: clip.start, origEnd: clip.end };
      lastPointerRef.current = { x: event.clientX, y: event.clientY };

      const onMove = (moveEvent: MouseEvent) => {
        if (!dragRef.current) return;
        lastPointerRef.current = { x: moveEvent.clientX, y: moveEvent.clientY };
        const dt = (moveEvent.clientX - dragRef.current.startX) / pixelsPerSecond;
        const duration = dragRef.current.origEnd - dragRef.current.origStart;
        const start = Math.max(0, dragRef.current.origStart + dt);
        updateClip(clip.id, { start, end: start + duration });
      };
      const onUp = () => {
        const targetElement = document
          .elementFromPoint(lastPointerRef.current.x, lastPointerRef.current.y)
          ?.closest("[data-timeline-track-id]") as HTMLElement | null;
        const targetTrack = tracks.find((candidate) => candidate.id === targetElement?.dataset.timelineTrackId);
        if (targetTrack && targetTrack.id !== track.id) {
          if (canDropOnTrack(targetTrack, clip.type)) {
            moveClipToTrack(clip.id, targetTrack.id);
          } else {
            const reason = getDropRejectReason(track, targetTrack, clip.type);
            if (reason) setNotice(reason);
          }
        }
        dragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [clip, moveClipToTrack, pixelsPerSecond, selectClip, setNotice, setRightPanelTab, track, tracks, updateClip]
  );

  const onTrimMouseDown = useCallback(
    (edge: "start" | "end", event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      selectClip(clip.id, event.ctrlKey || event.metaKey);
      setRightPanelTab("effect-controls");
      if (track.locked) return;
      trimRef.current = { edge, startX: event.clientX, origStart: clip.start, origEnd: clip.end };

      const onMove = (moveEvent: MouseEvent) => {
        if (!trimRef.current) return;
        const dt = (moveEvent.clientX - trimRef.current.startX) / pixelsPerSecond;
        if (trimRef.current.edge === "start") {
          const nextStart = Math.max(0, Math.min(trimRef.current.origStart + dt, trimRef.current.origEnd - 0.1));
          updateClip(clip.id, { start: nextStart, trimStart: Math.max(0, nextStart - trimRef.current.origStart) });
          return;
        }
        const nextEnd = Math.max(trimRef.current.origStart + 0.1, trimRef.current.origEnd + dt);
        updateClip(clip.id, { end: nextEnd, trimEnd: Math.max(0, trimRef.current.origEnd - nextEnd) });
      };
      const onUp = () => {
        trimRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [clip, pixelsPerSecond, selectClip, setRightPanelTab, track.locked, updateClip]
  );

  if (!media || left + width < 0 || clip.visible === false) return null;
  const isAudioClip = clip.type === "audio";

  return (
    <div
      className="absolute top-1 bottom-1 px-2 flex items-center text-[10px] select-none overflow-hidden"
      onMouseDown={onMouseDown}
      style={{
        left: visibleLeft,
        width: visibleWidth,
        background: clipColor(clip.type),
        color: "#ffffff",
        border: selected ? "2px solid var(--accent)" : "2px solid var(--border-subtle)",
        boxShadow: selected ? "0 0 0 2px var(--accent)" : "none",
        opacity: track.visible ? 1 : 0.35,
        cursor: track.locked ? "not-allowed" : "grab",
      }}
      title={media.name}
    >
      {isAudioClip && (
        <WaveformTrack
          height={Math.max(16, track.height - 8)}
          mediaId={clip.mediaId}
          duration={clip.end - clip.start}
        />
      )}
      <span
        className="absolute left-0 top-0 bottom-0 z-20 w-1.5 cursor-ew-resize rounded-l"
        onMouseDown={(event) => onTrimMouseDown("start", event)}
        style={{ background: selected ? "var(--accent)" : "var(--clip-handle)" }}
      />
      <span
        className="relative z-10 truncate rounded px-1"
        style={{ background: isAudioClip ? "var(--clip-label-bg)" : "transparent" }}
      >
        {media.name}
      </span>
      <span
        className="absolute right-0 top-0 bottom-0 z-20 w-1.5 cursor-ew-resize rounded-r"
        onMouseDown={(event) => onTrimMouseDown("end", event)}
        style={{ background: selected ? "var(--accent)" : "var(--clip-handle)" }}
      />
    </div>
  );
}

export default function TimelineTrack({ track }: Props) {
  const { toggleTrackLock, toggleTrackVisibility, toggleTrackMute, addClip, pixelsPerSecond, scrollLeft, setSelectedTrack, tracks, setNotice } =
    useTimelineStore();
  const mediaFiles = useEditorStore((s) => s.mediaFiles);
  const captions = useCaptionStore((s) => s.captions);
  const duration = usePlaybackStore((s) => s.duration);

  const clips = useMemo(() => track.clips || [], [track.clips]);
  const trackDuration = useMemo(() => Math.max(duration, ...clips.map((clip) => clip.end), 30), [clips, duration]);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const mediaId = event.dataTransfer.getData("application/x-huygen-caps-media");
      const media = mediaFiles.find((file) => file.id === mediaId);
      if (!media) return;
      const clipType = track.type === "audio" && media.type === "video" ? "audio" : media.type;
      if (!canDropOnTrack(track, clipType)) {
        const reason = getDropRejectReason(track, track, clipType);
        if (reason) setNotice(reason);
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const dropX = event.clientX - rect.left - TRACK_HEADER_WIDTH;
      const start = pixelToTime(dropX, pixelsPerSecond, scrollLeft);
      const clipDuration = media.type === "image" ? 5 : Math.max(0.1, media.duration || 5);
      addClip(track.id, {
        type: clipType,
        mediaId: media.id,
        start,
        end: start + clipDuration,
        visible: true,
        volume: clipType === "audio" ? 1 : undefined,
        muted: clipType === "audio" ? false : undefined,
        transform: { xPercent: 50, yPercent: 50, scale: 1, rotation: 0, opacity: 1 },
      });
    },
    [addClip, mediaFiles, pixelsPerSecond, scrollLeft, setNotice, track]
  );

  return (
    <div
      className="flex"
      data-timeline-track-id={track.id}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
      onClick={() => setSelectedTrack(track.id)}
      style={{
        height: track.height,
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div
        className="flex items-center gap-1 px-2 shrink-0 select-none"
        style={{
          width: TRACK_HEADER_WIDTH,
          background: "var(--bg-sidebar)",
          borderRight: "1px solid var(--border)",
          opacity: track.visible ? 1 : 0.55,
        }}
      >
        <span className="text-[10px] font-mono font-bold" style={{ color: "var(--text-muted)" }}>
          {track.label}
        </span>
        <div className="flex-1" />
        <button className="p-0.5 rounded hover:bg-[var(--hover-surface)]" onClick={() => toggleTrackLock(track.id)}>
          {track.locked ? <Lock size={10} style={{ color: "var(--accent)" }} /> : <Unlock size={10} style={{ color: "var(--text-muted)" }} />}
        </button>
        {track.type === "audio" ? (
          <button className="p-0.5 rounded hover:bg-[var(--hover-surface)]" onClick={() => toggleTrackMute(track.id)}>
            {track.muted ? <VolumeX size={10} style={{ color: "var(--accent)" }} /> : <Volume2 size={10} style={{ color: "var(--text-muted)" }} />}
          </button>
        ) : (
          <button className="p-0.5 rounded hover:bg-[var(--hover-surface)]" onClick={() => toggleTrackVisibility(track.id)}>
            {track.visible ? <Eye size={10} style={{ color: "var(--text-muted)" }} /> : <EyeOff size={10} style={{ color: "var(--accent)" }} />}
          </button>
        )}
      </div>

      <div className="flex-1 relative overflow-hidden" style={{ background: "var(--track-bg)", minWidth: trackDuration * pixelsPerSecond }}>
        {clips.map((clip) =>
          clip.type === "audio" ? (
            <div key={clip.id} style={{ opacity: track.muted ? 0.25 : 1 }}>
              <MediaClipBlock clip={clip} track={track} />
            </div>
          ) : (
            <MediaClipBlock key={clip.id} clip={clip} track={track} />
          )
        )}
        {(track.type === "caption" || track.type === "overlay") &&
          track.visible &&
          captions
            .filter((caption) => captionBelongsOnTrack(caption, track, tracks))
            .map((caption) => <CaptionBlock key={caption.id} caption={caption} track={track} />)}
      </div>
    </div>
  );
}
