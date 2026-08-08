"use client";

import { create } from "zustand";
import { normalizeCaptionStyleConfig } from "@/lib/captionStyleConfig";
import { normalizeExportSettings, normalizeSequenceSettings } from "@/lib/editorModel";
import { configureProjectHistory, runWithoutProjectHistory } from "@/lib/projectHistory";
import { Caption, CaptionChunkingConfig, CaptionLayerTransform, CaptionStyleConfig, CaptionTheme, ExportSettings, Language, SequenceSettings, TimelineTrack } from "@/lib/types";
import { useCaptionStore } from "./captionStore";
import { useEditorStore } from "./editorStore";
import { useTimelineStore } from "./timelineStore";

interface ProjectHistorySnapshot {
  label?: string;
  editor: {
    language: Language;
    theme: CaptionTheme;
    captionStyleConfig: CaptionStyleConfig;
    captionChunkingConfig: CaptionChunkingConfig;
    captionLayerTransform: CaptionLayerTransform;
    sequenceSettings: SequenceSettings;
    exportSettings: ExportSettings;
  };
  timeline: {
    tracks: TimelineTrack[];
    selectedClipIds: string[];
    selectedTrackId: string | null;
  };
  captions: Caption[];
  selectedCaptionIds: string[];
}

interface ProjectHistoryState {
  past: ProjectHistorySnapshot[];
  future: ProjectHistorySnapshot[];
  canUndo: boolean;
  canRedo: boolean;
  capture: (label?: string) => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
}

const MAX_HISTORY = 80;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableSnapshotKey(snapshot: ProjectHistorySnapshot) {
  return JSON.stringify(snapshot);
}

function captureSnapshot(label?: string): ProjectHistorySnapshot {
  const editor = useEditorStore.getState();
  const timeline = useTimelineStore.getState();
  const caption = useCaptionStore.getState();
  const sequenceSettings = normalizeSequenceSettings(editor.sequenceSettings);

  return {
    label,
    editor: {
      language: editor.language,
      theme: editor.theme,
      captionStyleConfig: normalizeCaptionStyleConfig(editor.captionStyleConfig),
      captionChunkingConfig: clone(editor.captionChunkingConfig),
      captionLayerTransform: clone(editor.captionLayerTransform),
      sequenceSettings,
      exportSettings: normalizeExportSettings(editor.exportSettings, sequenceSettings),
    },
    timeline: {
      tracks: clone(timeline.tracks),
      selectedClipIds: [...timeline.selectedClipIds],
      selectedTrackId: timeline.selectedTrackId,
    },
    captions: clone(caption.captions),
    selectedCaptionIds: Array.from(caption.selectedIds),
  };
}

function restoreSnapshot(snapshot: ProjectHistorySnapshot) {
  runWithoutProjectHistory(() => {
    const sequenceSettings = normalizeSequenceSettings(snapshot.editor.sequenceSettings);
    useEditorStore.setState({
      language: snapshot.editor.language,
      theme: snapshot.editor.theme,
      captionStyleConfig: normalizeCaptionStyleConfig(snapshot.editor.captionStyleConfig),
      captionChunkingConfig: clone(snapshot.editor.captionChunkingConfig),
      captionLayerTransform: clone(snapshot.editor.captionLayerTransform),
      sequenceSettings,
      exportSettings: normalizeExportSettings(snapshot.editor.exportSettings, sequenceSettings),
    });
    useTimelineStore.setState({
      tracks: clone(snapshot.timeline.tracks),
      selectedClipIds: [...snapshot.timeline.selectedClipIds],
      selectedTrackId: snapshot.timeline.selectedTrackId,
    });
    useCaptionStore.setState({
      captions: clone(snapshot.captions),
      selectedIds: new Set(snapshot.selectedCaptionIds),
      editingId: null,
    });
  });
}

function withFlags(past: ProjectHistorySnapshot[], future: ProjectHistorySnapshot[]) {
  return {
    past,
    future,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}

export const useProjectHistoryStore = create<ProjectHistoryState>((set, get) => ({
  past: [],
  future: [],
  canUndo: false,
  canRedo: false,

  capture: (label) =>
    set((state) => {
      const snapshot = captureSnapshot(label);
      const previous = state.past[state.past.length - 1];
      if (previous && stableSnapshotKey(previous) === stableSnapshotKey(snapshot)) {
        return state;
      }

      const past = [...state.past, snapshot].slice(-MAX_HISTORY);
      return withFlags(past, []);
    }),

  undo: () => {
    const state = get();
    if (!state.past.length) return;
    const present = captureSnapshot("Redo point");
    const past = state.past.slice(0, -1);
    const target = state.past[state.past.length - 1];
    restoreSnapshot(target);
    set(withFlags(past, [present, ...state.future].slice(0, MAX_HISTORY)));
  },

  redo: () => {
    const state = get();
    if (!state.future.length) return;
    const present = captureSnapshot("Undo point");
    const [target, ...future] = state.future;
    restoreSnapshot(target);
    set(withFlags([...state.past, present].slice(-MAX_HISTORY), future));
  },

  clear: () => set(withFlags([], [])),
}));

configureProjectHistory((label) => {
  useProjectHistoryStore.getState().capture(label);
});
