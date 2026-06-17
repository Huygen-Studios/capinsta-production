/* Editor Store — global editor state */

import { create } from "zustand";
import { DEFAULT_WORD_HIGHLIGHT_BOX_CONFIG, normalizeCaptionStyleConfig } from "@/lib/captionStyleConfig";
import { getCaptionPreset } from "@/lib/captionStylePresets";
import { DEFAULT_CAPTION_CHUNKING_CONFIG, DEFAULT_CAPTION_TIMING_CONFIG } from "@/lib/captionUtils";
import { DEFAULT_EXPORT_SETTINGS, DEFAULT_SEQUENCE_SETTINGS, normalizeExportSettings, normalizeSequenceSettings } from "@/lib/editorModel";
import { recordProjectHistory } from "@/lib/projectHistory";
import {
  AlignedSegment,
  CaptionChunkingConfig,
  CaptionLayerTransform,
  CaptionStylePresetId,
  CaptionTimingConfig,
  ColorMode,
  ExportSettings,
  CaptionStyleConfig,
  CaptionTheme,
  Language,
  LeftSidebarTab,
  MediaFile,
  RightPanelTab,
  SequenceSettings,
  ToolMode,
} from "@/lib/types";

interface EditorState {
  colorMode: ColorMode;
  setColorMode: (mode: ColorMode) => void;

  // Tool
  activeTool: ToolMode;
  setActiveTool: (tool: ToolMode) => void;
  leftSidebarTab: LeftSidebarTab;
  setLeftSidebarTab: (tab: LeftSidebarTab) => void;

  // Media
  mediaFiles: MediaFile[];
  activeMediaId: string | null;
  addMedia: (file: MediaFile) => void;
  removeMedia: (id: string) => void;
  setActiveMedia: (id: string | null) => void;

  // Settings
  language: Language;
  setLanguage: (lang: Language) => void;
  theme: CaptionTheme;
  setTheme: (theme: CaptionTheme) => void;
  applyCaptionStylePreset: (presetId: CaptionStylePresetId) => void;
  captionStyleConfig: CaptionStyleConfig;
  setCaptionStyleConfig: (config: Partial<CaptionStyleConfig>) => void;
  resetCaptionStyleConfig: (presetId?: CaptionStylePresetId) => void;
  savedCaptionPresets: CaptionStyleConfig[];
  saveCaptionPreset: (name?: string) => void;
  captionChunkingConfig: CaptionChunkingConfig;
  setCaptionChunkingConfig: (config: Partial<CaptionChunkingConfig>) => void;
  captionCharsPerSubtitle: number;
  setCaptionCharsPerSubtitle: (chars: number) => void;
  captionNeedsRebuild: boolean;
  setCaptionNeedsRebuild: (needsRebuild: boolean) => void;
  captionTimingConfig: CaptionTimingConfig;
  setCaptionTimingConfig: (config: Partial<CaptionTimingConfig>) => void;
  transcriptSegments: AlignedSegment[];
  setTranscriptSegments: (segments: AlignedSegment[]) => void;
  captionLayerTransform: CaptionLayerTransform;
  setCaptionLayerTransform: (transform: Partial<CaptionLayerTransform>) => void;
  sequenceSettings: SequenceSettings;
  setSequenceSettings: (settings: Partial<SequenceSettings>) => void;
  exportSettings: ExportSettings;
  setExportSettings: (settings: Partial<ExportSettings>) => void;

  // Pipeline
  jobId: string | null;
  setJobId: (id: string | null) => void;
  pipelineStatus: string;
  pipelinePercent: number;
  setPipelineProgress: (status: string, percent: number) => void;

  // Panels
  mediaPanelTab: "project" | "effects" | "history";
  setMediaPanelTab: (tab: "project" | "effects" | "history") => void;
  rightPanelTab: RightPanelTab;
  setRightPanelTab: (tab: RightPanelTab) => void;

  // Export
  showExportModal: boolean;
  setShowExportModal: (show: boolean) => void;
  showSequenceSettings: boolean;
  setShowSequenceSettings: (show: boolean) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  colorMode: "dark",
  setColorMode: (mode) => set({ colorMode: mode }),

  activeTool: "selection",
  setActiveTool: (tool) => set({ activeTool: tool }),
  leftSidebarTab: "subtitles",
  setLeftSidebarTab: (tab) => set({ leftSidebarTab: tab }),

  mediaFiles: [],
  activeMediaId: null,
  addMedia: (file) =>
    set((state) => ({
      mediaFiles: [...state.mediaFiles, file],
      activeMediaId: state.activeMediaId || file.id,
    })),
  removeMedia: (id) =>
    set((state) => ({
      mediaFiles: state.mediaFiles.filter((f) => f.id !== id),
      activeMediaId: state.activeMediaId === id ? null : state.activeMediaId,
    })),
  setActiveMedia: (id) => set({ activeMediaId: id }),

  language: "auto_mixed_indian",
  setLanguage: (lang) => set({ language: lang }),
  theme: "word_highlight_box",
  setTheme: (theme) => {
    recordProjectHistory("Caption theme");
    set({ theme });
  },
  applyCaptionStylePreset: (presetId) =>
    set((state) => {
      recordProjectHistory("Caption style preset");
      const preset = getCaptionPreset(presetId);
      const captionStyleConfig = normalizeCaptionStyleConfig(preset.defaultStyleConfig);
      const captionChunkingConfig =
        presetId === "modern_minimalist_lockup"
          ? state.captionChunkingConfig
          : {
              ...state.captionChunkingConfig,
              ...preset.defaultChunkingConfig,
            };
      return {
        theme: presetId,
        captionStyleConfig,
        captionChunkingConfig,
        captionLayerTransform: {
          xPercent: captionStyleConfig.positionX,
          yPercent: captionStyleConfig.positionY,
          scale: captionStyleConfig.scale,
          rotation: captionStyleConfig.rotation,
          opacity: captionStyleConfig.opacity,
          anchor: "center",
        },
      };
    }),
  captionStyleConfig: DEFAULT_WORD_HIGHLIGHT_BOX_CONFIG,
  setCaptionStyleConfig: (config) =>
    set((state) => {
      recordProjectHistory("Caption style", { debounceKey: "caption-style-config", debounceMs: 700 });
      const captionStyleConfig = normalizeCaptionStyleConfig({
        ...state.captionStyleConfig,
        ...config,
      });
      return {
        captionStyleConfig,
        captionLayerTransform: {
          ...state.captionLayerTransform,
          xPercent: captionStyleConfig.positionX,
          yPercent: captionStyleConfig.positionY,
          scale: captionStyleConfig.scale,
          rotation: captionStyleConfig.rotation,
          opacity: captionStyleConfig.opacity,
        },
      };
    }),
  resetCaptionStyleConfig: (presetId) =>
    set((state) => {
      recordProjectHistory("Reset caption style");
      const preset = getCaptionPreset(presetId || (state.theme as CaptionStylePresetId) || "word_highlight_box");
      const captionStyleConfig = normalizeCaptionStyleConfig(preset.defaultStyleConfig);
      return {
        captionStyleConfig,
        theme: preset.id,
        captionLayerTransform: {
          xPercent: captionStyleConfig.positionX,
          yPercent: captionStyleConfig.positionY,
          scale: captionStyleConfig.scale,
          rotation: captionStyleConfig.rotation,
          opacity: captionStyleConfig.opacity,
          anchor: "center",
        },
      };
    }),
  savedCaptionPresets: [],
  saveCaptionPreset: (name) =>
    set((state) => ({
      savedCaptionPresets: [
        ...state.savedCaptionPresets,
        normalizeCaptionStyleConfig({
          ...state.captionStyleConfig,
          presetName: name?.trim() || state.captionStyleConfig.presetName || "Custom Word Highlight Box",
        }),
      ].slice(-12),
    })),
  captionChunkingConfig: DEFAULT_CAPTION_CHUNKING_CONFIG,
  setCaptionChunkingConfig: (config) =>
    set((state) => ({
      captionChunkingConfig: {
        ...state.captionChunkingConfig,
        ...config,
      },
    })),
  captionCharsPerSubtitle: DEFAULT_CAPTION_CHUNKING_CONFIG.maxCharsPerCaption,
  setCaptionCharsPerSubtitle: (chars) => set({ captionCharsPerSubtitle: Math.max(18, Math.min(160, Math.round(chars))) }),
  captionNeedsRebuild: false,
  setCaptionNeedsRebuild: (needsRebuild) => set({ captionNeedsRebuild: needsRebuild }),
  captionTimingConfig: {
    ...DEFAULT_CAPTION_TIMING_CONFIG,
    globalOffsetSeconds: Number(process.env.NEXT_PUBLIC_DEFAULT_GLOBAL_CAPTION_OFFSET || 0) || 0,
  },
  setCaptionTimingConfig: (config) =>
    set((state) => ({
      captionTimingConfig: {
        ...state.captionTimingConfig,
        ...config,
        globalOffsetSeconds: Math.max(-1, Math.min(1, config.globalOffsetSeconds ?? state.captionTimingConfig.globalOffsetSeconds)),
        phrasePostHoldSeconds: Math.max(0, Math.min(0.5, config.phrasePostHoldSeconds ?? state.captionTimingConfig.phrasePostHoldSeconds)),
        pauseClearThresholdSeconds: Math.max(0.1, Math.min(1.2, config.pauseClearThresholdSeconds ?? state.captionTimingConfig.pauseClearThresholdSeconds)),
      },
    })),
  transcriptSegments: [],
  setTranscriptSegments: (segments) => set({ transcriptSegments: segments }),
  captionLayerTransform: {
    xPercent: 50,
    yPercent: 78,
    scale: 1,
    rotation: 0,
    opacity: 1,
    anchor: "center",
  },
  setCaptionLayerTransform: (transform) =>
    set((state) => {
      recordProjectHistory("Caption transform", { debounceKey: "caption-layer-transform", debounceMs: 700 });
      const next = {
        ...state.captionLayerTransform,
        ...transform,
        xPercent: Math.min(100, Math.max(0, transform.xPercent ?? state.captionLayerTransform.xPercent)),
        yPercent: Math.min(100, Math.max(0, transform.yPercent ?? state.captionLayerTransform.yPercent)),
        scale: Math.min(3, Math.max(0, transform.scale ?? state.captionLayerTransform.scale)),
        rotation: Math.min(180, Math.max(-180, transform.rotation ?? state.captionLayerTransform.rotation)),
        opacity: Math.min(1, Math.max(0, transform.opacity ?? state.captionLayerTransform.opacity)),
      };
      return {
        captionLayerTransform: next,
        captionStyleConfig: normalizeCaptionStyleConfig({
          ...state.captionStyleConfig,
          positionX: next.xPercent,
          positionY: next.yPercent,
          scale: next.scale,
          rotation: next.rotation,
          opacity: next.opacity,
        }),
      };
    }),
  sequenceSettings: DEFAULT_SEQUENCE_SETTINGS,
  setSequenceSettings: (settings) =>
    set((state) => {
      recordProjectHistory("Sequence settings");
      const sequenceSettings = normalizeSequenceSettings({ ...state.sequenceSettings, ...settings });
      return {
        sequenceSettings,
        exportSettings: normalizeExportSettings(state.exportSettings, sequenceSettings),
      };
    }),
  exportSettings: DEFAULT_EXPORT_SETTINGS,
  setExportSettings: (settings) =>
    set((state) => {
      recordProjectHistory("Export settings", { debounceKey: "export-settings", debounceMs: 500 });
      return {
        exportSettings: normalizeExportSettings({ ...state.exportSettings, ...settings }, state.sequenceSettings),
      };
    }),

  jobId: null,
  setJobId: (id) => set({ jobId: id }),
  pipelineStatus: "",
  pipelinePercent: 0,
  setPipelineProgress: (status, percent) =>
    set({ pipelineStatus: status, pipelinePercent: percent }),

  mediaPanelTab: "project",
  setMediaPanelTab: (tab) => set({ mediaPanelTab: tab }),
  rightPanelTab: "caption-style",
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),

  showExportModal: false,
  setShowExportModal: (show) => set({ showExportModal: show }),
  showSequenceSettings: false,
  setShowSequenceSettings: (show) => set({ showSequenceSettings: show }),
}));
