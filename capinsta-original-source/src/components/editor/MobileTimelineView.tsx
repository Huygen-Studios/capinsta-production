"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { usePlaybackStore } from "@/store/playbackStore";
import { useTimelineStore } from "@/store/timelineStore";
import { TimelineClip, TimelineTrack } from "@/lib/types";

function clipColor(type: TimelineClip["type"]) {
  if (type === "video") return "var(--clip-video)";
  if (type === "audio") return "var(--clip-audio)";
  if (type === "image") return "var(--clip-image)";
  return "var(--clip-caption)";
}

function trackIcon(track: TimelineTrack) {
  if (track.type === "audio") return "A";
  if (track.type === "caption") return "C";
  if (track.type === "overlay") return "O";
  return "V";
}

export default function MobileTimelineView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const currentTime = usePlaybackStore((s) => s.currentTime);
  const setCurrentTime = usePlaybackStore((s) => s.setCurrentTime);
  const playbackDuration = usePlaybackStore((s) => s.duration);
  const { tracks, pixelsPerSecond, setPixelsPerSecond, fitZoom } = useTimelineStore();

  const duration = useMemo(
    () => Math.max(30, playbackDuration, ...tracks.flatMap((track) => (track.clips || []).map((clip) => clip.end))),
    [playbackDuration, tracks]
  );
  const viewportWidth = containerRef.current?.clientWidth || 360;
  const sidePad = Math.max(120, viewportWidth / 2);
  const contentWidth = duration * pixelsPerSecond + sidePad * 2;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const target = sidePad + currentTime * pixelsPerSecond - element.clientWidth / 2;
    if (Math.abs(element.scrollLeft - target) > 2) element.scrollLeft = Math.max(0, target);
  }, [currentTime, pixelsPerSecond, sidePad]);

  const handleScroll = () => {
    const element = containerRef.current;
    if (!element) return;
    const center = element.scrollLeft + element.clientWidth / 2 - sidePad;
    const time = Math.max(0, Math.min(duration, center / pixelsPerSecond));
    setCurrentTime(time);
  };

  return (
    <section className="mobile-timeline">
      <div className="mobile-timeline-controls">
        <button onClick={() => setPixelsPerSecond(pixelsPerSecond / 1.12)} title="Zoom out">
          <Minus size={15} />
        </button>
        <button onClick={() => fitZoom(duration, viewportWidth)} title="Fit timeline">
          <Maximize2 size={15} />
        </button>
        <button onClick={() => setPixelsPerSecond(pixelsPerSecond * 1.12)} title="Zoom in">
          <Plus size={15} />
        </button>
      </div>
      <div className="mobile-timeline-playhead" />
      <div ref={containerRef} className="mobile-timeline-scroll" onScroll={handleScroll}>
        <div className="mobile-timeline-content" style={{ width: contentWidth }}>
          {tracks.map((track) => (
            <div key={track.id} className="mobile-timeline-track" style={{ opacity: track.visible ? 1 : 0.45 }}>
              <div className="mobile-timeline-track-label">{trackIcon(track)}</div>
              <div className="mobile-timeline-lane">
                {(track.clips || []).map((clip) => (
                  <div
                    key={clip.id}
                    className="mobile-timeline-clip"
                    style={{
                      left: sidePad + clip.start * pixelsPerSecond,
                      width: Math.max(28, (clip.end - clip.start) * pixelsPerSecond),
                      background: clipColor(clip.type),
                    }}
                  >
                    {clip.type}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
