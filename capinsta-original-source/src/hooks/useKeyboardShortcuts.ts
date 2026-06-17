/* useKeyboardShortcuts - Premiere Pro-style keyboard shortcuts */

"use client";

import { useEffect } from "react";
import { useCaptionStore } from "@/store/captionStore";
import { useEditorStore } from "@/store/editorStore";
import { usePlaybackStore } from "@/store/playbackStore";
import { useProjectHistoryStore } from "@/store/projectHistoryStore";
import { useTimelineStore } from "@/store/timelineStore";
import { isCaptionLocked } from "@/lib/editorModel";

export function useKeyboardShortcuts() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;

      switch (e.key) {
        case " ":
          e.preventDefault();
          if (!useTimelineStore.getState().tracks.some((track) => (track.clips || []).some((clip) => clip.type === "video"))) {
            useTimelineStore.getState().setNotice("Import a video before playback.");
            break;
          }
          usePlaybackStore.getState().togglePlayPause();
          break;

        case "z":
        case "Z":
          if (ctrl) {
            e.preventDefault();
            if (shift) {
              useProjectHistoryStore.getState().redo();
            } else {
              useProjectHistoryStore.getState().undo();
            }
          } else if (!shift) {
            useEditorStore.getState().setActiveTool("zoom");
          }
          break;

        case "y":
        case "Y":
          if (ctrl) {
            e.preventDefault();
            useProjectHistoryStore.getState().redo();
          }
          break;

        case "v":
        case "V":
          if (!ctrl) useEditorStore.getState().setActiveTool("selection");
          break;

        case "c":
        case "C":
          if (!ctrl) useEditorStore.getState().setActiveTool("razor");
          break;

        case "h":
        case "H":
          if (!ctrl) useEditorStore.getState().setActiveTool("hand");
          break;

        case "ArrowRight":
          e.preventDefault();
          {
            const fps = useEditorStore.getState().sequenceSettings.fps || 30;
            usePlaybackStore.getState().seekBy(shift ? 5 / fps : 1 / fps);
          }
          break;

        case "ArrowLeft":
          e.preventDefault();
          {
            const fps = useEditorStore.getState().sequenceSettings.fps || 30;
            usePlaybackStore.getState().seekBy(shift ? -5 / fps : -1 / fps);
          }
          break;

        case "Delete":
        case "Backspace":
          {
            const captionState = useCaptionStore.getState();
            const tracks = useTimelineStore.getState().tracks;
            Array.from(captionState.selectedIds).forEach((captionId) => {
              const caption = captionState.captions.find((candidate) => candidate.id === captionId);
              if (!caption || isCaptionLocked(caption, tracks)) return;
              captionState.deleteCaption(captionId);
            });
            useTimelineStore.getState().deleteSelectedClips();
          }
          break;

        case "a":
        case "A":
          if (ctrl) {
            e.preventDefault();
            useCaptionStore.getState().selectAll();
          }
          break;

        case "+":
        case "=":
          useTimelineStore.getState().zoomIn();
          break;

        case "-":
        case "_":
          useTimelineStore.getState().zoomOut();
          break;

        case "g":
        case "G":
          if (!ctrl) {
            document.getElementById("generate-captions-btn")?.click();
          }
          break;

        case "m":
        case "M":
          if (ctrl) {
            e.preventDefault();
            useEditorStore.getState().setShowExportModal(true);
          }
          break;

        case "s":
        case "S":
          if (ctrl) {
            e.preventDefault();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
