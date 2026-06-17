/* useCaptionExport — SRT/ASS/TXT export */

"use client";

import { useCallback, useMemo } from "react";
import { useCaptionStore } from "@/store/captionStore";
import { useEditorStore } from "@/store/editorStore";
import { useTimelineStore } from "@/store/timelineStore";
import { generateSRT, generateASS, downloadFile, getCaptionDisplayText } from "@/lib/captionUtils";
import { captionBelongsOnTrack } from "@/lib/editorModel";

export function useCaptionExport() {
  const captions = useCaptionStore((s) => s.captions);
  const theme = useEditorStore((s) => s.theme);
  const sequenceSettings = useEditorStore((s) => s.sequenceSettings);
  const visibleTracksOnly = useEditorStore((s) => s.exportSettings.visibleTracksOnly);
  const tracks = useTimelineStore((s) => s.tracks);
  const exportCaptions = useMemo(
    () =>
      visibleTracksOnly
        ? captions.filter((caption) =>
            tracks.some((track) => (track.type === "caption" || track.type === "overlay") && track.visible && captionBelongsOnTrack(caption, track, tracks))
          )
        : captions,
    [captions, tracks, visibleTracksOnly]
  );

  const exportSRT = useCallback(() => {
    const srt = generateSRT(exportCaptions);
    downloadFile(srt, "captions.srt", "text/plain");
  }, [exportCaptions]);

  const exportASS = useCallback(() => {
    const ass = generateASS(exportCaptions, theme, true, {
      width: sequenceSettings.width,
      height: sequenceSettings.height,
    });
    downloadFile(ass, "captions.ass", "text/plain");
  }, [exportCaptions, sequenceSettings.height, sequenceSettings.width, theme]);

  const exportTXT = useCallback(() => {
    const txt = [...exportCaptions]
      .sort((a, b) => a.start - b.start)
      .map(getCaptionDisplayText)
      .join("\n");
    downloadFile(txt, "captions.txt", "text/plain");
  }, [exportCaptions]);

  return { exportSRT, exportASS, exportTXT };
}
