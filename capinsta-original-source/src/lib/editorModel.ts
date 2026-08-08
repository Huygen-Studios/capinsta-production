import {
  Caption,
  ClipTransform,
  ExportFrameRate,
  ExportSettings,
  MediaFile,
  SequenceAspectRatio,
  SequenceResolutionPreset,
  SequenceSettings,
  TimelineClip,
  TimelineTrack,
  VideoFrameRate,
} from "./types";

export const FRAME_RATE_PRESETS: VideoFrameRate[] = [24, 25, 30, 50, 60];

export const SEQUENCE_RESOLUTION_PRESETS: Record<
  Exclude<SequenceResolutionPreset, "custom">,
  { width: number; height: number; aspectRatio: Exclude<SequenceAspectRatio, "custom">; label: string }
> = {
  "1080x1920": { width: 1080, height: 1920, aspectRatio: "9:16", label: "1080 x 1920" },
  "1920x1080": { width: 1920, height: 1080, aspectRatio: "16:9", label: "1920 x 1080" },
  "1080x1080": { width: 1080, height: 1080, aspectRatio: "1:1", label: "1080 x 1080" },
  "1080x1350": { width: 1080, height: 1350, aspectRatio: "4:5", label: "1080 x 1350" },
  "720x1280": { width: 720, height: 1280, aspectRatio: "9:16", label: "720 x 1280" },
};

export const ASPECT_RATIO_PRESETS: Record<
  Exclude<SequenceAspectRatio, "custom">,
  { width: number; height: number; resolutionPreset: Exclude<SequenceResolutionPreset, "custom"> }
> = {
  "9:16": { width: 1080, height: 1920, resolutionPreset: "1080x1920" },
  "16:9": { width: 1920, height: 1080, resolutionPreset: "1920x1080" },
  "1:1": { width: 1080, height: 1080, resolutionPreset: "1080x1080" },
  "4:5": { width: 1080, height: 1350, resolutionPreset: "1080x1350" },
};

export const DEFAULT_SEQUENCE_SETTINGS: SequenceSettings = {
  width: 1080,
  height: 1920,
  fps: 30,
  aspectRatio: "9:16",
  resolutionPreset: "1080x1920",
  backgroundColor: "#101010",
  safeMarginsEnabled: true,
  safeMarginsPercent: 8,
  safeMargins: 8,
};

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  format: "mp4",
  mode: "full_video",
  resolutionPreset: "sequence",
  width: 1080,
  height: 1920,
  aspectRatio: "sequence",
  fps: "sequence",
  quality: "balanced",
  bitrate: "auto",
  customBitrateMbps: 18,
  includeAudio: true,
  visibleTracksOnly: true,
  burnCaptions: true,
  hardwareAcceleration: false,
  backgroundColor: "#101010",
  durationSource: "sequence",
  customDuration: 15,
  resolution: "1080p",
};

export const DEFAULT_CLIP_TRANSFORM: ClipTransform = {
  xPercent: 50,
  yPercent: 50,
  scale: 1,
  rotation: 0,
  opacity: 1,
};

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function normalizeClipTransform(transform?: Partial<ClipTransform>): ClipTransform {
  return {
    xPercent: clampNumber(transform?.xPercent ?? DEFAULT_CLIP_TRANSFORM.xPercent, 0, 100),
    yPercent: clampNumber(transform?.yPercent ?? DEFAULT_CLIP_TRANSFORM.yPercent, 0, 100),
    scale: clampNumber(transform?.scale ?? DEFAULT_CLIP_TRANSFORM.scale, 0.05, 5),
    rotation: clampNumber(transform?.rotation ?? DEFAULT_CLIP_TRANSFORM.rotation, -180, 180),
    opacity: clampNumber(transform?.opacity ?? DEFAULT_CLIP_TRANSFORM.opacity, 0, 1),
  };
}

function normalizeFps(value: unknown): VideoFrameRate {
  const fps = Number(value);
  return FRAME_RATE_PRESETS.includes(fps as VideoFrameRate) ? (fps as VideoFrameRate) : 30;
}

export function inferAspectRatio(width: number, height: number): SequenceAspectRatio {
  const ratio = width / Math.max(1, height);
  if (Math.abs(ratio - 9 / 16) < 0.02) return "9:16";
  if (Math.abs(ratio - 16 / 9) < 0.02) return "16:9";
  if (Math.abs(ratio - 1) < 0.02) return "1:1";
  if (Math.abs(ratio - 4 / 5) < 0.02) return "4:5";
  return "custom";
}

export function inferResolutionPreset(width: number, height: number): SequenceResolutionPreset {
  const found = Object.entries(SEQUENCE_RESOLUTION_PRESETS).find(
    ([, preset]) => preset.width === width && preset.height === height
  );
  return (found?.[0] as SequenceResolutionPreset | undefined) || "custom";
}

export function normalizeSequenceSettings(settings?: Partial<SequenceSettings>): SequenceSettings {
  const width = Math.max(1, Math.round(Number(settings?.width ?? DEFAULT_SEQUENCE_SETTINGS.width)));
  const height = Math.max(1, Math.round(Number(settings?.height ?? DEFAULT_SEQUENCE_SETTINGS.height)));
  const safeMarginsPercent = clampNumber(
    settings?.safeMarginsPercent ?? settings?.safeMargins ?? DEFAULT_SEQUENCE_SETTINGS.safeMarginsPercent,
    0,
    25
  );
  const inferredResolution = inferResolutionPreset(width, height);
  const inferredAspect = inferAspectRatio(width, height);
  const resolutionPreset = settings?.resolutionPreset || inferredResolution;
  const presetAspect =
    resolutionPreset !== "custom" ? SEQUENCE_RESOLUTION_PRESETS[resolutionPreset]?.aspectRatio : undefined;

  return {
    ...DEFAULT_SEQUENCE_SETTINGS,
    ...settings,
    width,
    height,
    fps: normalizeFps(settings?.fps),
    aspectRatio: settings?.aspectRatio || presetAspect || inferredAspect,
    resolutionPreset,
    backgroundColor: settings?.backgroundColor || DEFAULT_SEQUENCE_SETTINGS.backgroundColor,
    safeMarginsEnabled: settings?.safeMarginsEnabled ?? true,
    safeMarginsPercent,
    safeMargins: safeMarginsPercent,
  };
}

export function normalizeExportSettings(settings?: Partial<ExportSettings>, sequence?: SequenceSettings): ExportSettings {
  const normalizedSequence = normalizeSequenceSettings(sequence);
  const legacyResolution = settings?.resolution;
  const resolutionPreset =
    settings?.resolutionPreset ||
    (legacyResolution === "720p" ? "720x1280" : legacyResolution === "480p" ? "720x1280" : "sequence");
  const width = Math.max(1, Math.round(Number(settings?.width ?? normalizedSequence.width)));
  const height = Math.max(1, Math.round(Number(settings?.height ?? normalizedSequence.height)));
  const fps =
    settings?.fps == null
      ? DEFAULT_EXPORT_SETTINGS.fps
      : settings.fps === "sequence"
      ? "sequence"
      : normalizeFps(settings.fps);
  const legacyQuality = settings?.quality as string | undefined;
  const quality =
    legacyQuality === "draft"
      ? "low_bitrate"
      : legacyQuality === "standard"
      ? "balanced"
      : legacyQuality === "high"
      ? "high"
      : settings?.quality || DEFAULT_EXPORT_SETTINGS.quality;

  return {
    ...DEFAULT_EXPORT_SETTINGS,
    ...settings,
    format: "mp4",
    mode: settings?.mode || DEFAULT_EXPORT_SETTINGS.mode,
    resolutionPreset,
    width,
    height,
    aspectRatio: settings?.aspectRatio || "sequence",
    fps,
    quality,
    bitrate: settings?.bitrate || DEFAULT_EXPORT_SETTINGS.bitrate,
    customBitrateMbps: clampNumber(settings?.customBitrateMbps ?? DEFAULT_EXPORT_SETTINGS.customBitrateMbps, 0.5, 80),
    backgroundColor: settings?.backgroundColor || normalizedSequence.backgroundColor,
    customDuration: clampNumber(settings?.customDuration ?? DEFAULT_EXPORT_SETTINGS.customDuration, 0.1, 60 * 60),
  };
}

export function resolveExportDimensions(settings: ExportSettings, sequence: SequenceSettings) {
  const normalizedSequence = normalizeSequenceSettings(sequence);
  const normalizedExport = normalizeExportSettings(settings, normalizedSequence);
  if (
    normalizedExport.resolutionPreset === "sequence" &&
    normalizedExport.aspectRatio !== "sequence" &&
    normalizedExport.aspectRatio !== "custom"
  ) {
    const preset = ASPECT_RATIO_PRESETS[normalizedExport.aspectRatio];
    return { width: preset.width, height: preset.height };
  }
  if (normalizedExport.resolutionPreset === "sequence") {
    return { width: normalizedSequence.width, height: normalizedSequence.height };
  }
  if (normalizedExport.resolutionPreset === "custom") {
    return { width: normalizedExport.width, height: normalizedExport.height };
  }
  const preset = SEQUENCE_RESOLUTION_PRESETS[normalizedExport.resolutionPreset];
  return { width: preset.width, height: preset.height };
}

export function resolveExportFps(settings: ExportSettings, sequence: SequenceSettings): VideoFrameRate {
  const fps: ExportFrameRate = normalizeExportSettings(settings, sequence).fps;
  return fps === "sequence" ? normalizeSequenceSettings(sequence).fps : fps;
}

export function resolveExportAspectRatio(settings: ExportSettings, sequence: SequenceSettings): SequenceAspectRatio {
  const aspect = normalizeExportSettings(settings, sequence).aspectRatio;
  return aspect === "sequence" ? normalizeSequenceSettings(sequence).aspectRatio : aspect;
}

export interface ExportDurationResult {
  duration: number;
  source: "custom" | "timeline" | "media" | "captions" | "sequence" | "none";
}

export function determineExportDuration({
  exportSettings,
  sequenceSettings,
  mediaFiles,
  tracks,
  captions,
  playbackDuration = 0,
}: {
  exportSettings: ExportSettings;
  sequenceSettings: SequenceSettings;
  mediaFiles: MediaFile[];
  tracks: TimelineTrack[];
  captions: Caption[];
  playbackDuration?: number;
}): ExportDurationResult {
  const normalizedExport = normalizeExportSettings(exportSettings, sequenceSettings);
  const timelineDuration = Math.max(
    ...tracks.flatMap((track) => track.clips || []).map((clip) => clip.end),
    0
  );
  const mediaDuration = Math.max(...mediaFiles.map((media) => media.duration || 0), 0);
  const captionsDuration = Math.max(...captions.map((caption) => caption.end), 0);
  const sequenceDuration = Math.max(playbackDuration, timelineDuration, mediaDuration, captionsDuration);

  if (normalizedExport.durationSource === "custom" && normalizedExport.customDuration > 0) {
    return { duration: normalizedExport.customDuration, source: "custom" };
  }

  if (normalizedExport.mode === "captions_only") {
    if (normalizedExport.durationSource === "caption" && captionsDuration > 0) return { duration: captionsDuration, source: "captions" };
    if (normalizedExport.durationSource === "timeline" && timelineDuration > 0) return { duration: timelineDuration, source: "timeline" };
    if (normalizedExport.durationSource === "sequence" && sequenceDuration > 0) return { duration: sequenceDuration, source: "sequence" };
    if (captionsDuration > 0) return { duration: captionsDuration, source: "captions" };
  }

  if (timelineDuration > 0) return { duration: timelineDuration, source: "timeline" };
  if (mediaDuration > 0) return { duration: mediaDuration, source: "media" };
  if (captionsDuration > 0) return { duration: captionsDuration, source: "captions" };
  if (sequenceDuration > 0) return { duration: sequenceDuration, source: "sequence" };

  return { duration: 0, source: "none" };
}

export function findClipWithTrack(tracks: TimelineTrack[], clipId?: string | null) {
  if (!clipId) return null;
  for (const track of tracks) {
    const clip = (track.clips || []).find((candidate) => candidate.id === clipId);
    if (clip) return { clip, track };
  }
  return null;
}

export function canEditTrack(track?: TimelineTrack | null) {
  return Boolean(track && !track.locked);
}

export function canEditClip(track?: TimelineTrack | null) {
  return canEditTrack(track);
}

export function canMoveClip(sourceTrack?: TimelineTrack | null) {
  return canEditTrack(sourceTrack);
}

export function canTrimClip(sourceTrack?: TimelineTrack | null) {
  return canEditTrack(sourceTrack);
}

export function canDropOnTrack(track: TimelineTrack | undefined | null, clipKind: TimelineClip["type"]) {
  if (!track || track.locked) return false;

  if (clipKind === "video") return track.type === "video" || track.type === "overlay";
  if (clipKind === "audio") return track.type === "audio";
  if (clipKind === "image") return track.type === "image" || track.type === "overlay" || track.type === "video";
  if (clipKind === "caption") return track.type === "caption" || track.type === "overlay";
  if (clipKind === "overlay") return track.type === "overlay" || track.type === "video";

  return false;
}

export function canMoveClipToTrack(
  sourceTrack: TimelineTrack | undefined | null,
  targetTrack: TimelineTrack | undefined | null,
  clipKind: TimelineClip["type"]
) {
  return canMoveClip(sourceTrack) && canDropOnTrack(targetTrack, clipKind);
}

export function getDropRejectReason(
  sourceTrack: TimelineTrack | undefined | null,
  targetTrack: TimelineTrack | undefined | null,
  clipKind: TimelineClip["type"]
) {
  if (!sourceTrack) return "Source track not found.";
  if (sourceTrack.locked) return `${sourceTrack.label} is locked. Unlock it before moving clips.`;
  if (!targetTrack) return "Drop on a track row.";
  if (targetTrack.locked) return `${targetTrack.label} is locked.`;
  if (!canDropOnTrack(targetTrack, clipKind)) {
    const visualCopy = clipKind === "audio"
      ? "Audio clips can only be placed on audio tracks."
      : `${clipKind} clips can only be placed on compatible visual tracks.`;
    return `${visualCopy} ${targetTrack.label} is a ${targetTrack.type} track.`;
  }
  return "";
}

export function defaultCaptionTrackId(tracks: TimelineTrack[]) {
  return tracks.find((track) => track.type === "caption")?.id || "c1";
}

export function getCaptionTrack(caption: Caption, tracks: TimelineTrack[]) {
  const explicitTrack = caption.trackId ? tracks.find((track) => track.id === caption.trackId) : undefined;
  if (explicitTrack) return explicitTrack;
  return tracks.find((track) => track.type === "caption") || null;
}

export function isCaptionLocked(caption: Caption, tracks: TimelineTrack[]) {
  return Boolean(getCaptionTrack(caption, tracks)?.locked);
}

export function captionBelongsOnTrack(caption: Caption, track: TimelineTrack, tracks: TimelineTrack[]) {
  const captionTrackId = caption.trackId || defaultCaptionTrackId(tracks);
  return captionTrackId === track.id && (track.type === "caption" || track.type === "overlay");
}
