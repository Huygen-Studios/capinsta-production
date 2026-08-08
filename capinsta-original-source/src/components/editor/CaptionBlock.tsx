/* CaptionBlock - individual caption block on timeline */

"use client";

import React, { useCallback, useRef } from "react";
import { Caption, TimelineTrack } from "@/lib/types";
import { canDropOnTrack, getDropRejectReason } from "@/lib/editorModel";
import { getCaptionDisplayText } from "@/lib/captionUtils";
import { timeToPixel, pixelToTime } from "@/lib/timelineUtils";
import { useCaptionStore } from "@/store/captionStore";
import { useEditorStore } from "@/store/editorStore";
import { useTimelineStore } from "@/store/timelineStore";

interface Props {
  caption: Caption;
  track: TimelineTrack;
}

export default function CaptionBlock({ caption, track }: Props) {
  const { selectedIds, selectCaption, setEditingId, updateCaption, splitCaption } = useCaptionStore();
  const { pixelsPerSecond, scrollLeft, tracks, setNotice } = useTimelineStore();
  const activeTool = useEditorStore((s) => s.activeTool);
  const setRightPanelTab = useEditorStore((s) => s.setRightPanelTab);

  const left = timeToPixel(caption.start, pixelsPerSecond, scrollLeft);
  const width = (caption.end - caption.start) * pixelsPerSecond;
  const displayWidth = Math.max(82, width);
  const isSelected = selectedIds.has(caption.id);
  const dragRef = useRef<{ type: "move" | "left" | "right"; startX: number; startY: number; origStart: number; origEnd: number } | null>(null);
  const lastPointerRef = useRef({ x: 0, y: 0 });

  const handleMouseDown = useCallback(
    (event: React.MouseEvent, type: "move" | "left" | "right") => {
      event.stopPropagation();
      event.preventDefault();
      if (track.locked) return;

      if (activeTool === "razor" && type === "move") {
        const container = (event.target as HTMLElement).closest("[data-timeline-area]");
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const localX = event.clientX - rect.left + scrollLeft;
        splitCaption(caption.id, pixelToTime(localX, pixelsPerSecond));
        return;
      }

      dragRef.current = {
        type,
        startX: event.clientX,
        startY: event.clientY,
        origStart: caption.start,
        origEnd: caption.end,
      };
      lastPointerRef.current = { x: event.clientX, y: event.clientY };

      const onMove = (moveEvent: MouseEvent) => {
        if (!dragRef.current) return;
        lastPointerRef.current = { x: moveEvent.clientX, y: moveEvent.clientY };
        const dx = moveEvent.clientX - dragRef.current.startX;
        const dt = dx / pixelsPerSecond;

        if (dragRef.current.type === "move") {
          const duration = dragRef.current.origEnd - dragRef.current.origStart;
          const start = Math.max(0, dragRef.current.origStart + dt);
          updateCaption(caption.id, { start, end: start + duration });
          return;
        }

        if (dragRef.current.type === "left") {
          const start = Math.max(0, Math.min(caption.end - 0.1, dragRef.current.origStart + dt));
          updateCaption(caption.id, { start });
          return;
        }

        const end = Math.max(caption.start + 0.1, dragRef.current.origEnd + dt);
        updateCaption(caption.id, { end });
      };

      const onUp = () => {
        if (dragRef.current?.type === "move") {
          const targetElement = document
            .elementFromPoint(lastPointerRef.current.x, lastPointerRef.current.y)
            ?.closest("[data-timeline-track-id]") as HTMLElement | null;
          const targetTrack = tracks.find((candidate) => candidate.id === targetElement?.dataset.timelineTrackId);

          if (targetTrack && targetTrack.id !== track.id) {
            if (canDropOnTrack(targetTrack, "caption")) {
              updateCaption(caption.id, { trackId: targetTrack.id });
            } else {
              const reason = getDropRejectReason(track, targetTrack, "caption");
              if (reason) setNotice(reason);
            }
          }
        }

        dragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [activeTool, caption, pixelsPerSecond, scrollLeft, setNotice, splitCaption, track, tracks, updateCaption]
  );

  const langClass =
    caption.lang === "english"
      ? "lang-en"
      : caption.lang === "telgish"
      ? "lang-telgish"
      : caption.lang === "auto_mixed_indian"
      ? "lang-auto"
      : "lang-hinglish";

  if (left + width < 0) return null;
  const displayText = getCaptionDisplayText(caption);

  return (
    <div
      className={`caption-block ${langClass} ${isSelected ? "selected" : ""}`}
      style={{
        left: Math.max(0, left),
        width: displayWidth,
        minWidth: 82,
        background: isSelected ? "#F5B21A" : undefined,
        borderColor: isSelected ? "#15E0D2" : undefined,
        boxShadow: isSelected ? "0 0 0 2px #15E0D2" : undefined,
        cursor: track.locked ? "not-allowed" : activeTool === "razor" ? "crosshair" : "grab",
        opacity: track.locked ? 0.72 : 1,
      }}
      title={track.locked ? "Track locked" : displayText}
      onClick={(event) => {
        event.stopPropagation();
        selectCaption(caption.id, event.ctrlKey || event.metaKey);
        setRightPanelTab("caption-editor");
      }}
      onDoubleClick={() => {
        if (!track.locked) setEditingId(caption.id);
      }}
      onMouseDown={(event) => handleMouseDown(event, "move")}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-white/20"
        onMouseDown={(event) => handleMouseDown(event, "left")}
      />
      <span className="block min-w-0 truncate text-[10px] font-bold leading-tight">{displayText}</span>
      <div
        className="absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-white/20"
        onMouseDown={(event) => handleMouseDown(event, "right")}
      />
    </div>
  );
}
