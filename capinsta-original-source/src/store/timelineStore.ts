/* Timeline Store — timeline zoom, scroll, tracks */

import { create } from "zustand";
import { TimelineClip, TimelineTrack } from "@/lib/types";
import {
  canDropOnTrack,
  canMoveClipToTrack,
  findClipWithTrack,
  normalizeClipTransform,
} from "@/lib/editorModel";
import { recordProjectHistory } from "@/lib/projectHistory";

interface TimelineState {
  pixelsPerSecond: number;
  scrollLeft: number;
  snapEnabled: boolean;

  tracks: TimelineTrack[];
  selectedClipIds: string[];
  selectedTrackId: string | null;
  notice: string | null;

  setPixelsPerSecond: (pps: number) => void;
  setScrollLeft: (sl: number) => void;
  setTimelineView: (pps: number, sl: number) => void;
  toggleSnap: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitZoom: (duration: number, viewportWidth: number) => void;

  addTrack: (track: TimelineTrack) => void;
  addTrackByType: (type: TimelineTrack["type"]) => void;
  removeTrack: (id: string) => void;
  toggleTrackLock: (id: string) => void;
  toggleTrackVisibility: (id: string) => void;
  toggleTrackMute: (id: string) => void;
  addClip: (trackId: string, clip: Omit<TimelineClip, "id" | "trackId">) => void;
  updateClip: (clipId: string, updates: Partial<TimelineClip>) => void;
  moveClipToTrack: (clipId: string, targetTrackId: string, nextStart?: number) => void;
  removeClipsByMediaId: (mediaId: string) => void;
  deleteSelectedClips: () => void;
  duplicateSelectedClips: () => void;
  selectClip: (clipId: string, multi?: boolean) => void;
  setSelectedTrack: (trackId: string | null) => void;
  setNotice: (message: string | null) => void;
  clearNotice: () => void;
  initDefaultTracks: () => void;
}

export const DEFAULT_TIMELINE_PPS = 40;
export const MIN_TIMELINE_PPS = 5;
export const MAX_TIMELINE_PPS = 220;

function clampPixelsPerSecond(value: number) {
  return Math.max(MIN_TIMELINE_PPS, Math.min(MAX_TIMELINE_PPS, Number.isFinite(value) ? value : DEFAULT_TIMELINE_PPS));
}

function clampScrollLeft(value: number) {
  return Math.max(0, Number.isFinite(value) ? value : 0);
}

export const useTimelineStore = create<TimelineState>((set) => ({
  pixelsPerSecond: DEFAULT_TIMELINE_PPS,
  scrollLeft: 0,
  snapEnabled: true,

  tracks: [],
  selectedClipIds: [],
  selectedTrackId: null,
  notice: null,

  setPixelsPerSecond: (pps) =>
    set({ pixelsPerSecond: clampPixelsPerSecond(pps) }),

  setScrollLeft: (sl) => set({ scrollLeft: clampScrollLeft(sl) }),

  setTimelineView: (pps, sl) =>
    set({
      pixelsPerSecond: clampPixelsPerSecond(pps),
      scrollLeft: clampScrollLeft(sl),
    }),

  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),

  zoomIn: () =>
    set((s) => ({
      pixelsPerSecond: clampPixelsPerSecond(s.pixelsPerSecond * 1.12),
    })),

  zoomOut: () =>
    set((s) => ({
      pixelsPerSecond: clampPixelsPerSecond(s.pixelsPerSecond / 1.12),
    })),
  fitZoom: (duration, viewportWidth) =>
    set({
      pixelsPerSecond: clampPixelsPerSecond(Math.max(1, viewportWidth - 12) / Math.max(1, duration)),
      scrollLeft: 0,
    }),

  addTrack: (track) =>
    set((s) => {
      recordProjectHistory("Add track");
      return { tracks: [...s.tracks, { ...track, clips: track.clips || [] }] };
    }),

  addTrackByType: (type) =>
    set((s) => {
      recordProjectHistory("Add track");
      const prefix = type === "audio" ? "A" : type === "caption" ? "C" : type === "overlay" ? "O" : "V";
      const matching = s.tracks.filter((track) =>
        type === "video" ? track.type === "video" || track.type === "image" : track.type === type
      );
      const label = `${prefix}${matching.length + 1}`;
      const newTrack: TimelineTrack = {
        id: `${type}_${Date.now()}`,
        type,
        label,
        name: label,
        locked: false,
        visible: true,
        muted: type === "audio" ? false : undefined,
        height: type === "caption" ? 36 : 48,
        zIndex: type === "caption" ? 35 + matching.length : type === "overlay" ? 25 + matching.length : type === "video" ? 10 + matching.length : 0,
        clips: [],
      };
      const tracks =
        type === "audio"
          ? [...s.tracks, newTrack]
          : type === "caption"
          ? [newTrack, ...s.tracks]
          : [
              ...s.tracks.filter((track) => track.type === "caption"),
              newTrack,
              ...s.tracks.filter((track) => track.type !== "caption"),
            ];
      return {
        tracks,
      };
    }),

  removeTrack: (id) =>
    set((s) => {
      recordProjectHistory("Remove track");
      return { tracks: s.tracks.filter((t) => t.id !== id) };
    }),

  toggleTrackLock: (id) =>
    set((s) => {
      recordProjectHistory("Toggle track lock");
      return {
        tracks: s.tracks.map((t) =>
          t.id === id ? { ...t, locked: !t.locked } : t
        ),
      };
    }),

  toggleTrackVisibility: (id) =>
    set((s) => {
      recordProjectHistory("Toggle track visibility");
      return {
        tracks: s.tracks.map((t) =>
          t.id === id ? { ...t, visible: !t.visible } : t
        ),
      };
    }),

  toggleTrackMute: (id) =>
    set((s) => {
      recordProjectHistory("Toggle track mute");
      return {
        tracks: s.tracks.map((t) =>
          t.id === id ? { ...t, muted: !t.muted } : t
        ),
      };
    }),

  addClip: (trackId, clip) =>
    set((s) => {
      recordProjectHistory("Add clip");
      return {
        tracks: s.tracks.map((track) =>
          track.id === trackId && canDropOnTrack(track, clip.type)
            ? {
                ...track,
                clips: [
                  ...(track.clips || []),
                  {
                    ...clip,
                    id: `clip_${Date.now()}_${Math.random().toString(16).slice(2)}`,
                    trackId,
                    visible: clip.visible ?? true,
                    volume: clip.type === "audio" ? clip.volume ?? 1 : clip.volume,
                    muted: clip.type === "audio" ? clip.muted ?? false : clip.muted,
                    transform: clip.type === "audio" ? clip.transform : normalizeClipTransform(clip.transform),
                  },
                ],
              }
            : track
        ),
      };
    }),

  updateClip: (clipId, updates) =>
    set((s) => {
      recordProjectHistory("Update clip", { debounceKey: `clip:${clipId}`, debounceMs: 700 });
      return {
        tracks: s.tracks.map((track) =>
          track.locked
            ? track
            : {
                ...track,
                clips: (track.clips || []).map((clip) =>
                  clip.id === clipId
                    ? {
                        ...clip,
                        ...updates,
                        transform: updates.transform
                          ? normalizeClipTransform({ ...clip.transform, ...updates.transform })
                          : clip.transform,
                      }
                    : clip
                ),
              }
        ),
      };
    }),

  moveClipToTrack: (clipId, targetTrackId, nextStart) =>
    set((s) => {
      const found = findClipWithTrack(s.tracks, clipId);
      const targetTrack = s.tracks.find((track) => track.id === targetTrackId);
      if (!found || !targetTrack || !canMoveClipToTrack(found.track, targetTrack, found.clip.type)) {
        return s;
      }
      recordProjectHistory("Move clip to track", { debounceKey: `clip:${clipId}`, debounceMs: 700 });

      const duration = Math.max(0.1, found.clip.end - found.clip.start);
      const start = Math.max(0, nextStart ?? found.clip.start);
      const movedClip: TimelineClip = {
        ...found.clip,
        trackId: targetTrack.id,
        start,
        end: start + duration,
      };

      return {
        ...s,
        selectedTrackId: targetTrack.id,
        tracks: s.tracks.map((track) => {
          if (track.id === found.track.id) {
            return { ...track, clips: (track.clips || []).filter((clip) => clip.id !== clipId) };
          }
          if (track.id === targetTrack.id) {
            return { ...track, clips: [...(track.clips || []), movedClip] };
          }
          return track;
        }),
      };
    }),

  removeClipsByMediaId: (mediaId) =>
    set((s) => {
      recordProjectHistory("Remove media clips");
      return {
        selectedClipIds: s.selectedClipIds.filter((clipId) => {
          const found = findClipWithTrack(s.tracks, clipId);
          return found?.clip.mediaId !== mediaId;
        }),
        tracks: s.tracks.map((track) => ({
          ...track,
          clips: (track.clips || []).filter((clip) => clip.mediaId !== mediaId),
        })),
      };
    }),

  deleteSelectedClips: () =>
    set((s) => {
      const selected = new Set(s.selectedClipIds);
      if (!selected.size) return s;
      recordProjectHistory("Delete clips");
      const deleted = new Set<string>();
      const tracks = s.tracks.map((track) => {
        if (track.locked) return track;
        const nextClips = (track.clips || []).filter((clip) => {
          const shouldDelete = selected.has(clip.id);
          if (shouldDelete) deleted.add(clip.id);
          return !shouldDelete;
        });
        return { ...track, clips: nextClips };
      });
      return {
        selectedClipIds: s.selectedClipIds.filter((clipId) => !deleted.has(clipId)),
        tracks,
      };
    }),

  duplicateSelectedClips: () =>
    set((s) => {
      const selected = new Set(s.selectedClipIds);
      if (!selected.size) return s;
      const duplicatedIds: string[] = [];
      const tracks = s.tracks.map((track) => {
        if (track.locked) return track;
        const duplicates = (track.clips || [])
          .filter((clip) => selected.has(clip.id))
          .map((clip) => {
            const duration = Math.max(0.1, clip.end - clip.start);
            const id = `clip_${Date.now()}_${Math.random().toString(16).slice(2)}`;
            duplicatedIds.push(id);
            return {
              ...clip,
              id,
              start: clip.start + duration,
              end: clip.end + duration,
            };
          });
        return duplicates.length ? { ...track, clips: [...(track.clips || []), ...duplicates] } : track;
      });
      if (!duplicatedIds.length) return s;
      recordProjectHistory("Duplicate clips");
      return { tracks, selectedClipIds: duplicatedIds };
    }),

  selectClip: (clipId, multi = false) =>
    set((s) => {
      const found = findClipWithTrack(s.tracks, clipId);
      return {
        selectedTrackId: found?.track.id || s.selectedTrackId,
        selectedClipIds: multi
          ? s.selectedClipIds.includes(clipId)
            ? s.selectedClipIds.filter((id) => id !== clipId)
            : [...s.selectedClipIds, clipId]
          : [clipId],
      };
    }),

  setSelectedTrack: (trackId) => set({ selectedTrackId: trackId }),
  setNotice: (message) => set({ notice: message }),
  clearNotice: () => set({ notice: null }),

  initDefaultTracks: () =>
    set({
      tracks: [
        { id: "c1", type: "caption", label: "C1", name: "Captions", locked: false, visible: true, height: 36, zIndex: 30, clips: [] },
        { id: "v1", type: "video", label: "V1", name: "Video", locked: false, visible: true, height: 58, zIndex: 10, clips: [] },
        { id: "a1", type: "audio", label: "A1", name: "Audio", locked: false, visible: true, muted: false, height: 48, zIndex: 0, clips: [] },
      ],
    }),
}));
