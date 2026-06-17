/* ExportModal - Huygen Caps export dialog */

"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileText, Film, Loader2, Save, X } from "lucide-react";
import { getExportJobStatus, resolveBackendUrl, startHeadlessExportJob } from "@/lib/api";
import { captionBelongsOnTrack, determineExportDuration, normalizeClipTransform, resolveExportDimensions, resolveExportFps } from "@/lib/editorModel";
import { applyCaptionTimingOffset, downloadFile } from "@/lib/captionUtils";
import { ExportDurationSource, ExportFormat, ExportFrameRate, ExportQualityPreset, ExportResolutionPreset, MediaFile, ProjectData, TimelineTrack } from "@/lib/types";
import { useCaptionExport } from "@/hooks/useCaptionExport";
import { useCaptionStore } from "@/store/captionStore";
import { useEditorStore } from "@/store/editorStore";
import { useTimelineStore } from "@/store/timelineStore";

interface ExportOption {
  type: "mp4_full_video" | "mp4_captions_only" | "srt" | "ass" | "json" | "project";
  format: ExportFormat;
  label: string;
  description: string;
  icon: React.ReactNode;
  mp4Mode?: "full_video" | "captions_only";
}

const options: ExportOption[] = [
  {
    type: "mp4_full_video",
    format: "mp4",
    label: "MP4 - Full Video",
    description: "Export video with captions and supported layers",
    icon: <Film size={19} />,
    mp4Mode: "full_video",
  },
  {
    type: "mp4_captions_only",
    format: "mp4",
    label: "MP4 - Captions Only",
    description: "Export animated captions on a solid background",
    icon: <Film size={19} />,
    mp4Mode: "captions_only",
  },
  {
    type: "srt",
    format: "srt",
    label: "SRT Subtitles",
    description: "Standard subtitle sidecar",
    icon: <FileText size={19} />,
  },
  {
    type: "ass",
    format: "ass",
    label: "ASS Subtitles",
    description: "Styled subtitle sidecar",
    icon: <FileText size={19} />,
  },
  {
    type: "json",
    format: "json",
    label: "Transcript JSON",
    description: "Caption and timing data",
    icon: <FileText size={19} />,
  },
  {
    type: "project",
    format: "project",
    label: "Project File",
    description: "Save Huygen Caps project data",
    icon: <Save size={19} />,
  },
];

type SelectedExportType = ExportOption["type"];

function normalizeHexInput(value: string) {
  const raw = value.trim();
  const match = raw.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!match) return null;
  const hex = match[1].length === 3 ? match[1].split("").map((ch) => ch + ch).join("") : match[1];
  return `#${hex.toLowerCase()}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-[10px] uppercase" style={{ color: "var(--text-muted)" }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function apiResolutionLabel(width: number, height: number) {
  const maxEdge = Math.max(width, height);
  if (maxEdge <= 854) return "480p";
  if (maxEdge <= 1280) return "720p";
  return "1080p";
}

function formatExportError(err: unknown) {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "Export failed";
  if (/export job not found/i.test(raw)) {
    return "Export status was lost before the MP4 finished. Please start the export again; if it repeats, check Render logs for a worker restart or memory limit during export.";
  }
  if (/\b502\b|bad gateway|backend is unreachable/i.test(raw)) {
    return "Backend export service became unreachable. Check Render logs, /health, and /health/export.";
  }
  const message = raw
    .replace(/^Headless export failed:\s*/i, "")
    .replace(/^Export failed during unexpected_error:\s*$/i, "Export failed during failed: backend returned an empty error. Check /api/health/export and the backend logs.")
    .trim();
  if (message.startsWith("<!DOCTYPE") || message.includes("<html")) {
    return "Export API returned an HTML page instead of JSON. Check that the editor is calling FastAPI, not the Next.js dev server.";
  }
  return message.length > 4500 ? `${message.slice(0, 4500)}...` : message;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

const MAX_EXPORT_IMAGE_DATA_URL_BYTES = 12 * 1024 * 1024;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read image file: ${file.name}`));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Could not read image file as a data URL: ${file.name}`));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

async function buildExportCompositionJson({
  tracks,
  mediaFiles,
  exportDuration,
  sourceMediaId,
}: {
  tracks: TimelineTrack[];
  mediaFiles: MediaFile[];
  exportDuration: number;
  sourceMediaId?: string;
}) {
  const layers = [];
  const unsupported: string[] = [];
  const visibleTracks = tracks.filter((track) => track.visible);
  const firstVideoMediaId = mediaFiles.find((file) => file.type === "video")?.id;
  const baseVideoMediaIds = new Set([sourceMediaId, firstVideoMediaId].filter(Boolean));

  for (const track of visibleTracks) {
    for (const clip of track.clips || []) {
      if (clip.visible === false || clip.type === "audio" || clip.type === "caption") continue;
      if (clip.end <= 0 || clip.start >= exportDuration || clip.end <= clip.start) continue;

      const media = mediaFiles.find((file) => file.id === clip.mediaId);
      if (!media) continue;

      if (clip.type === "image" && media.type === "image") {
        if (media.file.size > MAX_EXPORT_IMAGE_DATA_URL_BYTES) {
          throw new Error(
            `${media.name} is too large for image-layer MP4 export. Keep image overlays under ${Math.round(
              MAX_EXPORT_IMAGE_DATA_URL_BYTES / (1024 * 1024)
            )} MB.`
          );
        }
        layers.push({
          id: clip.id,
          clipId: clip.id,
          trackId: track.id,
          mediaId: media.id,
          name: media.name,
          type: "image",
          dataUrl: await fileToDataUrl(media.file),
          start: Math.max(0, clip.start),
          end: Math.min(exportDuration, clip.end),
          zIndex: track.zIndex || 0,
          transform: normalizeClipTransform(clip.transform),
        });
        continue;
      }

      if (clip.type === "video" && media.type === "video" && baseVideoMediaIds.has(media.id)) {
        continue;
      }

      if (clip.type === "video" || media.type === "video") {
        unsupported.push(media.name);
      }
    }
  }

  if (unsupported.length) {
    const unsupportedNames = Array.from(new Set(unsupported));
    throw new Error(
      `Some overlay types are not supported in MP4 export yet. Image overlays are supported; video overlays are planned. Unsupported: ${unsupportedNames.join(", ")}.`
    );
  }

  return JSON.stringify({
    version: 1,
    layers,
  });
}

function toAttachmentDownloadUrl(url: string) {
  const trimmed = url.trim();
  const exportPrefix = "/exports/";
  if (trimmed.startsWith(exportPrefix)) {
    return `/api/export/jobs/download/${encodeURIComponent(trimmed.slice(exportPrefix.length))}`;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname.startsWith(exportPrefix)) {
      const filename = parsed.pathname.slice(exportPrefix.length);
      return `${parsed.origin}/api/export/jobs/download/${encodeURIComponent(filename)}`;
    }
  } catch {
    // Relative API paths already point at the backend download route.
  }
  return trimmed;
}

export default function ExportModal() {
  const {
    showExportModal,
    setShowExportModal,
    language,
    theme,
    mediaFiles,
    jobId,
    captionStyleConfig,
    captionChunkingConfig,
    captionTimingConfig,
    captionLayerTransform,
    sequenceSettings,
    exportSettings,
    setExportSettings,
  } = useEditorStore();
  const allCaptions = useCaptionStore((s) => s.captions);
  const captionDocument = useCaptionStore((s) => s.captionDocument);
  const tracks = useTimelineStore((s) => s.tracks);
  const { exportSRT, exportASS } = useCaptionExport();
  const [exporting, setExporting] = useState(false);
  const [exportPercent, setExportPercent] = useState(0);
  const [exportStatus, setExportStatus] = useState("");
  const [exportError, setExportError] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [downloadName, setDownloadName] = useState("");
  const [selectedExportType, setSelectedExportType] = useState<SelectedExportType>(
    exportSettings.mode === "captions_only" ? "mp4_captions_only" : "mp4_full_video"
  );
  const pollCancelledRef = useRef(false);

  const visibleCaptionTracks = useMemo(
    () => tracks.filter((track) => (track.type === "caption" || track.type === "overlay") && track.visible),
    [tracks]
  );
  const captionsForExport = useMemo(() => {
    if (!exportSettings.visibleTracksOnly) return allCaptions;
    return allCaptions.filter((caption) =>
      visibleCaptionTracks.some((track) => captionBelongsOnTrack(caption, track, tracks))
    );
  }, [allCaptions, exportSettings.visibleTracksOnly, tracks, visibleCaptionTracks]);
  const canonicalCaptionDocument = useMemo(
    () => ({
      id: captionDocument?.id || "captions_1",
      name: captionDocument?.name || "Generated captions",
      sourceMediaId: captionDocument?.sourceMediaId || captionsForExport.find((caption) => caption.sourceMediaId)?.sourceMediaId,
      languageMode: captionDocument?.languageMode || language,
      transcript: captionDocument?.transcript || {
        segments: captionsForExport.map((caption) => ({
          id: caption.id,
          start: caption.start,
          end: caption.end,
          text: caption.text,
          words: caption.words,
        })),
      },
      originalAlignedWords: captionDocument?.originalAlignedWords || captionsForExport.flatMap((caption) => caption.words || []),
      chunks: captionsForExport,
      style: captionStyleConfig,
      chunkingConfig: captionChunkingConfig,
      timingConfig: captionTimingConfig,
      coverageReport: captionDocument?.coverageReport,
    }),
    [
      captionChunkingConfig,
      captionDocument,
      captionStyleConfig,
      captionTimingConfig,
      captionsForExport,
      language,
    ]
  );

  useEffect(() => {
    if (!showExportModal) {
      pollCancelledRef.current = true;
      if (downloadUrl.startsWith("blob:")) URL.revokeObjectURL(downloadUrl);
      setDownloadUrl("");
      setDownloadName("");
    }
  }, [downloadUrl, showExportModal]);

  if (!showExportModal) return null;

  const timelineClips = tracks.flatMap((track) => track.clips || []);
  const timelineDuration = Math.max(
    mediaFiles[0]?.duration || 0,
    ...timelineClips.map((clip) => clip.end),
    ...allCaptions.map((caption) => caption.end),
    0.1
  );
  const exportDimensions = resolveExportDimensions(exportSettings, sequenceSettings);
  const exportFps = resolveExportFps(exportSettings, sequenceSettings);
  const durationInfo = determineExportDuration({
    exportSettings,
    sequenceSettings,
    mediaFiles,
    tracks,
    captions: captionsForExport,
    playbackDuration: timelineDuration,
  });
  const includeAudioForExport =
    exportSettings.mode === "captions_only"
      ? exportSettings.includeAudio
      : exportSettings.includeAudio &&
        tracks.some((track) => track.type === "audio" && track.visible && !track.muted);
  const exportDuration = durationInfo.duration;
  const selectedOption = options.find((option) => option.type === selectedExportType) || options[0];
  const selectedMp4Mode = selectedOption.mp4Mode || exportSettings.mode;
  const selectedIsMp4 = selectedOption.format === "mp4";
  const selectedIsCaptionsOnly = selectedOption.type === "mp4_captions_only";
  const selectedIncludeAudio =
    selectedIsCaptionsOnly
      ? exportSettings.includeAudio
      : exportSettings.includeAudio &&
        tracks.some((track) => track.type === "audio" && track.visible && !track.muted);

  const selectExportType = (option: ExportOption) => {
    setExportError("");
    setDownloadUrl((current) => {
      if (current.startsWith("blob:")) URL.revokeObjectURL(current);
      return "";
    });
    setDownloadName("");
    setSelectedExportType(option.type);
    if (option.mp4Mode === "full_video") {
      setExportSettings({ mode: "full_video" });
    } else if (option.mp4Mode === "captions_only") {
      setExportSettings({
        mode: "captions_only",
        includeAudio: false,
        backgroundColor: normalizeHexInput(exportSettings.backgroundColor) || "#00ff00",
      });
    }
  };

  const handleExport = async (format: ExportFormat, mp4Mode: "full_video" | "captions_only" = exportSettings.mode) => {
    setExportError("");
    setExportStatus("");
    setExportPercent(0);
    if (downloadUrl.startsWith("blob:")) URL.revokeObjectURL(downloadUrl);
    setDownloadUrl("");
    setDownloadName("");
    setExporting(true);

    switch (format) {
      case "srt":
        exportSRT();
        setExporting(false);
        setShowExportModal(false);
        return;
      case "ass":
        exportASS();
        setExporting(false);
        setShowExportModal(false);
        return;
      case "json":
        downloadFile(
          JSON.stringify(
            {
              product: "Huygen Caps",
              languageMode: language,
              segments: captionsForExport,
              captionDocument: canonicalCaptionDocument,
              styleConfig: captionStyleConfig,
              chunkingConfig: captionChunkingConfig,
              timingConfig: captionTimingConfig,
              layerTransform: captionLayerTransform,
              sequenceSettings,
              exportSettings,
            },
            null,
            2
          ),
          "huygen_caps_transcript.json",
          "application/json"
        );
        setExporting(false);
        setShowExportModal(false);
        return;
      case "project": {
        const project: ProjectData = {
          version: "6.0",
          timeline: {
            duration: timelineDuration,
            tracks,
            clips: timelineClips,
          },
          captions: captionsForExport,
          captionDocuments: [canonicalCaptionDocument],
          settings: {
            language,
            theme,
            captionStyleConfig,
              captionChunkingConfig,
              captionTimingConfig,
              captionLayerTransform,
            sequenceSettings,
            exportSettings,
          },
        };
        downloadFile(JSON.stringify(project, null, 2), "huygen_caps_project.json", "application/json");
        setExporting(false);
        setShowExportModal(false);
        return;
      }
      case "mp4":
        break;
    }

    if (!jobId) {
      setExportError("Generate captions once before MP4 export so Huygen Caps has a render job.");
      setExporting(false);
      return;
    }

    if (mp4Mode === "captions_only" && captionsForExport.length === 0) {
      setExportError("No captions found. Generate or import captions before exporting captions-only video.");
      setExporting(false);
      return;
    }

    if (exportDuration <= 0) {
      setExportError("Export failed because project duration could not be determined. Please check media metadata, timeline clips, captions, or set a custom export duration.");
      setExporting(false);
      return;
    }
    if (mp4Mode === "captions_only" && !normalizeHexInput(exportSettings.backgroundColor)) {
      setExportError("Enter a valid solid background color like #00ff00.");
      setExporting(false);
      return;
    }
    if (exportDimensions.width < 16 || exportDimensions.height < 16) {
      setExportError("Export width and height must be at least 16 pixels.");
      setExporting(false);
      return;
    }
    if (exportFps < 1 || exportFps > 120) {
      setExportError("Export FPS must be between 1 and 120.");
      setExporting(false);
      return;
    }

    try {
      setExportSettings({ format: "mp4", mode: mp4Mode });
      setExportStatus("Preparing Huygen render...");
      pollCancelledRef.current = false;

      const payloadCaptions = exportSettings.burnCaptions
        ? applyCaptionTimingOffset(captionsForExport, captionTimingConfig.globalOffsetSeconds)
        : [];
      const sourceMediaId = canonicalCaptionDocument.sourceMediaId || mediaFiles.find((file) => file.type === "video")?.id;
      const compositionJson =
        mp4Mode === "captions_only"
          ? JSON.stringify({ version: 1, layers: [] })
          : await buildExportCompositionJson({
              tracks,
              mediaFiles,
              exportDuration,
              sourceMediaId,
            });
      const includeAudio =
        mp4Mode === "captions_only"
          ? exportSettings.mode === "captions_only" && exportSettings.includeAudio
          : includeAudioForExport;
      console.info("huygen_export_request", {
        jobId,
        mode: mp4Mode,
        width: exportDimensions.width,
        height: exportDimensions.height,
        fps: exportFps,
        duration: exportDuration,
        durationSource: durationInfo.source,
        captions: payloadCaptions.length,
        exportGlobalOffsetSeconds: captionTimingConfig.globalOffsetSeconds,
        visibleTracks: visibleCaptionTracks.length,
        sourceMedia: mediaFiles.length,
        compositionLayers: JSON.parse(compositionJson).layers?.length || 0,
      });
      const started = await startHeadlessExportJob(
        jobId,
        JSON.stringify(payloadCaptions),
        theme,
        apiResolutionLabel(exportDimensions.width, exportDimensions.height),
        JSON.stringify(captionStyleConfig),
        {
          width: exportDimensions.width,
          height: exportDimensions.height,
          fps: exportFps,
          includeAudio,
          captionsOnly: mp4Mode === "captions_only",
          quality: exportSettings.quality,
          bitrate: exportSettings.bitrate,
          customBitrateMbps: exportSettings.customBitrateMbps,
          exportMode: mp4Mode,
          backgroundColor: mp4Mode === "captions_only" ? normalizeHexInput(exportSettings.backgroundColor) || "#00ff00" : sequenceSettings.backgroundColor,
          duration: exportDuration,
          durationSource: durationInfo.source,
          visibleTracksCount: visibleCaptionTracks.length,
          sourceMediaCount: mediaFiles.length,
          captionChunksCount: payloadCaptions.length,
          hardwareAcceleration: exportSettings.hardwareAcceleration,
          compositionJson: mp4Mode === "captions_only" ? undefined : compositionJson,
        }
      );
      setExportStatus(started.message || "Export started...");

      let missedPolls = 0;
      while (!pollCancelledRef.current) {
        await wait(1500);
        try {
          const status = await getExportJobStatus(started.statusUrl || started.jobId);
          missedPolls = 0;
          const nextPercent = Math.max(0, Math.min(100, status.progress || 0));
          setExportPercent(nextPercent);
          setExportStatus(status.message || status.stage || status.status);

          if (status.status === "completed") {
            if (!status.downloadUrl) {
              throw new Error("Export completed but did not return a download URL.");
            }
            setDownloadUrl(resolveBackendUrl(toAttachmentDownloadUrl(status.downloadUrl)));
            setDownloadName(status.filename || `huygen_caps_${mp4Mode}_${exportDimensions.width}x${exportDimensions.height}_${exportFps}fps.mp4`);
            setExportStatus("Export complete. MP4 is ready to download.");
            setExportPercent(100);
            setExporting(false);
            return;
          }

          if (status.status === "failed") {
            pollCancelledRef.current = true;
            setExportError(formatExportError(`Export failed during ${status.stage}: ${status.error || status.message || "backend export failed"}`));
            setExportStatus("Export failed");
            setExportPercent(-1);
            setExporting(false);
            return;
          }
        } catch (pollError) {
          missedPolls += 1;
          if (missedPolls >= 5) {
            throw pollError;
          }
          setExportStatus("Waiting for backend export status...");
        }
      }
    } catch (err: unknown) {
      pollCancelledRef.current = true;
      setExportError(formatExportError(err));
      setExportStatus("Export failed");
      setExportPercent(-1);
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={() => !exporting && setShowExportModal(false)} />

      <div className="modal-shell relative w-[min(760px,calc(100vw-32px))] overflow-hidden">
        <div className="panel-header justify-between">
          <div className="flex items-center gap-2">
            <Download size={16} style={{ color: "var(--accent)" }} />
            <span>Export</span>
          </div>
          <button className="icon-button" disabled={exporting} onClick={() => setShowExportModal(false)}>
            <X size={16} />
          </button>
        </div>

        <div className="grid gap-3 p-4 md:grid-cols-[1fr_300px]">
          <div className="grid gap-2">
            {options.map((option) => {
              const disabled = exporting || (option.format !== "mp4" && captionsForExport.length === 0);
              const selected = option.type === selectedExportType;
              return (
                <button
                  key={option.type}
                  className={`export-option${selected ? " selected" : ""}`}
                  disabled={disabled}
                  onClick={() => selectExportType(option)}
                >
                  <span className="export-option-icon">{option.icon}</span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block text-xs font-bold" style={{ color: "var(--text-primary)" }}>
                      {option.label}
                    </span>
                    <span className="block text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {option.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="grid content-start gap-3">
            <div className="brutal-box grid gap-2 p-3 text-[10px]" style={{ color: "var(--text-muted)" }}>
              <div className="font-bold uppercase" style={{ color: "var(--text-primary)" }}>
                {selectedOption.label}
              </div>
              {selectedIsMp4 ? (
                <>
                  <Field label="Output size">
                    <select
                      className="control-input"
                      value={exportSettings.resolutionPreset === "custom" ? "custom" : "sequence"}
                      onChange={(event) => setExportSettings({ resolutionPreset: event.target.value as ExportResolutionPreset })}
                    >
                      <option value="sequence">Same as sequence</option>
                      <option value="custom">Custom</option>
                    </select>
                  </Field>
                  {exportSettings.resolutionPreset === "custom" && (
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Width">
                        <input className="control-input" type="number" min={16} value={exportSettings.width} onChange={(event) => setExportSettings({ width: Number(event.target.value) })} />
                      </Field>
                      <Field label="Height">
                        <input className="control-input" type="number" min={16} value={exportSettings.height} onChange={(event) => setExportSettings({ height: Number(event.target.value) })} />
                      </Field>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="FPS">
                      <select className="control-input" value={exportSettings.fps} onChange={(event) => setExportSettings({ fps: event.target.value === "sequence" ? "sequence" : (Number(event.target.value) as ExportFrameRate) })}>
                        <option value="sequence">Same as sequence</option>
                        <option value={24}>24</option>
                        <option value={25}>25</option>
                        <option value={30}>30</option>
                        <option value={60}>60</option>
                      </select>
                    </Field>
                    <Field label="Quality">
                      <select className="control-input" value={exportSettings.quality} onChange={(event) => setExportSettings({ quality: event.target.value as ExportQualityPreset })}>
                        <option value="low_bitrate">Draft</option>
                        <option value="balanced">Balanced</option>
                        <option value="high">High</option>
                      </select>
                    </Field>
                  </div>
                  {selectedIsCaptionsOnly && (
                    <>
                      <Field label="Solid background color">
                        <div className="grid grid-cols-[44px_1fr] gap-2">
                          <input className="control-input h-9 p-1" type="color" value={normalizeHexInput(exportSettings.backgroundColor) || "#00ff00"} onChange={(event) => setExportSettings({ backgroundColor: event.target.value })} />
                          <input
                            className="control-input"
                            value={exportSettings.backgroundColor}
                            onChange={(event) => setExportSettings({ backgroundColor: event.target.value })}
                            onBlur={(event) => setExportSettings({ backgroundColor: normalizeHexInput(event.target.value) || "#00ff00" })}
                            placeholder="#00ff00"
                          />
                        </div>
                      </Field>
                      <Field label="Duration">
                        <select className="control-input" value={exportSettings.durationSource} onChange={(event) => setExportSettings({ durationSource: event.target.value as ExportDurationSource })}>
                          <option value="sequence">Same as sequence</option>
                          <option value="caption">Captions duration</option>
                          <option value="custom">Custom duration</option>
                        </select>
                      </Field>
                      {exportSettings.durationSource === "custom" && (
                        <Field label="Custom seconds">
                          <input className="control-input" type="number" min={0.1} step={0.1} value={exportSettings.customDuration} onChange={(event) => setExportSettings({ customDuration: Number(event.target.value) })} />
                        </Field>
                      )}
                    </>
                  )}
                  <label className="flex items-center justify-between text-[10px]" style={{ color: "var(--text-muted)" }}>
                    <span>{selectedIsCaptionsOnly ? "Include original audio" : "Include audio"}</span>
                    <input type="checkbox" checked={selectedIsCaptionsOnly ? exportSettings.includeAudio : selectedIncludeAudio} onChange={(event) => setExportSettings({ includeAudio: event.target.checked })} />
                  </label>
                  {!selectedIsCaptionsOnly && (
                    <label className="flex items-center justify-between text-[10px]" style={{ color: "var(--text-muted)" }}>
                      <span>Visible tracks only</span>
                      <input type="checkbox" checked={exportSettings.visibleTracksOnly} onChange={(event) => setExportSettings({ visibleTracksOnly: event.target.checked })} />
                    </label>
                  )}
                  <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {selectedIsCaptionsOnly ? "Captions Only ignores video, image, and overlay layers." : "Exports video with captions and supported layers."}
                  </p>
                  <div className="grid gap-1 border-t pt-2 font-mono" style={{ borderColor: "var(--border)" }}>
                    <div className="flex justify-between"><span>Size</span><span>{exportDimensions.width}x{exportDimensions.height}</span></div>
                    <div className="flex justify-between"><span>FPS</span><span>{exportFps}</span></div>
                    <div className="flex justify-between"><span>Duration</span><span>{exportDuration.toFixed(2)}s / {durationInfo.source}</span></div>
                    <div className="flex justify-between"><span>Captions</span><span>{captionsForExport.length}</span></div>
                  </div>
                </>
              ) : (
                <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {selectedOption.description}. Click Export when ready.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-3 border-t p-4" style={{ borderColor: "var(--border)" }}>
          {downloadUrl ? (
            <div className="editor-notice flex items-center justify-between gap-3">
              <span>{exportStatus || "Export complete."}</span>
              <a className="btn-primary" href={downloadUrl} download={downloadName}>
                Download MP4
              </a>
            </div>
          ) : exportError ? (
            <div className="editor-notice error flex items-center justify-between gap-3">
              <span className="max-h-40 min-w-0 overflow-auto whitespace-pre-wrap break-words">{exportError}</span>
              <button onClick={() => setExportError("")}>Clear</button>
            </div>
          ) : exporting ? (
            <div className="grid gap-2">
              <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-primary)" }}>
                <Loader2 size={14} className="animate-spin" style={{ color: "var(--accent)" }} />
                <span>{exportStatus || "Exporting..."}</span>
                {exportPercent > 0 && exportPercent <= 100 && <span>{exportPercent}%</span>}
              </div>
              {exportPercent > 0 && exportPercent <= 100 && (
                <div className="h-2 overflow-hidden border" style={{ background: "var(--bg-panel-dark)", borderColor: "var(--border)" }}>
                  <div className="h-full transition-all duration-500" style={{ width: `${exportPercent}%`, background: "var(--accent)" }} />
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 text-[10px]" style={{ color: "var(--text-muted)" }}>
              <span>{captionsForExport.length} caption{captionsForExport.length !== 1 ? "s" : ""} ready</span>
              <span>{selectedOption.label}</span>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" disabled={exporting} onClick={() => setShowExportModal(false)}>
              Cancel
            </button>
            <button className="btn-primary" disabled={exporting} onClick={() => handleExport(selectedOption.format, selectedMp4Mode)}>
              {exporting ? "Exporting..." : downloadUrl ? "Export Again" : "Export"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
