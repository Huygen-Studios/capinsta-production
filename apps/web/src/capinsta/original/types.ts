/* Types for Huygen Caps */

export type Language =
  | "auto"
  | "english"
  | "hindi"
  | "telugu"
  | "hinglish"
  | "telgish"
  | "auto_mixed_indian";
export type ToolMode = "selection" | "razor" | "hand" | "zoom";
export type LeftSidebarTab = "ai" | "media" | "text" | "subtitles" | "transcript" | "translate" | "templates";
export type ExportFormat = "mp4" | "srt" | "json" | "ass" | "project";
export type RightPanelTab = "effect-controls" | "caption-editor" | "caption-style" | "export-settings";
export type ColorMode = "dark" | "light";
export type VideoFrameRate = 24 | 25 | 30 | 50 | 60;
export type SequenceAspectRatio = "9:16" | "16:9" | "1:1" | "4:5" | "custom";
export type SequenceResolutionPreset = "1080x1920" | "1920x1080" | "1080x1080" | "1080x1350" | "720x1280" | "custom";
export type ExportMode = "full_video" | "captions_only";
export type ExportResolutionPreset = "sequence" | SequenceResolutionPreset;
export type ExportAspectRatio = "sequence" | SequenceAspectRatio;
export type ExportFrameRate = "sequence" | VideoFrameRate;
export type ExportQualityPreset = "best" | "high" | "balanced" | "low_bitrate" | "custom";
export type ExportBitrateMode = "auto" | "low" | "medium" | "high" | "custom";
export type ExportDurationSource = "caption" | "sequence" | "timeline" | "custom";

export type CaptionTheme =
  | "word_highlight_box"
  | "kinetic_fade"
  | "attention_punch"
  | "mrbeast_style"
  | "apple_cinematic"
  | "modern_minimalist_lockup"
  | "viral_word_highlight"
  | "minimal"
  | "viral_shorts"
  | "cinematic"
  | "kalakar_fire"
  | "karaoke_neon"
  | "dramatic"
  | "glassmorphism"
  | "retro_vhs"
  | "neon_glow"
  | "typewriter"
  | "comic_pop"
  | "elegant_serif"
  | "gradient_wave"
  | "outline_bold"
  | "shadow_3d"
  | "highlight_box";

export type CaptionStylePresetId =
  | "word_highlight_box"
  | "kinetic_fade"
  | "attention_punch"
  | "mrbeast_style"
  | "apple_cinematic"
  | "modern_minimalist_lockup";

export type CaptionTimingSource = "provider" | "whisperx" | "stable_ts" | "vad_adjusted" | "manual" | "estimated";

export interface MediaFile {
  id: string;
  name: string;
  type: "video" | "audio" | "image";
  size: number;
  duration: number;
  resolution?: { width: number; height: number };
  url: string;
  file: File;
  thumbnail?: string;
}

export interface Caption {
  id: string;
  trackId?: string;
  sourceMediaId?: string;
  start: number;
  end: number;
  text: string;
  lang: Language;
  theme: CaptionTheme;
  style?: CaptionStyle;
  words?: AlignedWord[];
  originalText?: string;
  manuallyEdited?: boolean;
  timingNeedsReview?: boolean;
  timingWarning?: string;
}

export interface CaptionStyle {
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  italic?: boolean;
  outline?: boolean;
  outlineColor?: string;
  position?: "bottom" | "top" | "center";
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  letterSpacing?: string;
  borderRadius?: string;
  padding?: string;
  backdropBlur?: number;
  gradient?: string;
  shadow?: string;
  animation?: "none" | "fade-in" | "slide-up" | "typewriter" | "pop" | "glow-pulse";
}

export interface TimelineTrack {
  id: string;
  type: "video" | "audio" | "caption" | "image" | "overlay";
  label: string;
  name?: string;
  locked: boolean;
  visible: boolean;
  muted?: boolean;
  height: number;
  zIndex?: number;
  clips?: TimelineClip[];
}

export interface ClipTransform {
  xPercent: number;
  yPercent: number;
  scale: number;
  rotation: number;
  opacity: number;
}

export interface TimelineClip {
  id: string;
  trackId: string;
  start: number;
  end: number;
  mediaId?: string;
  type: "video" | "audio" | "caption" | "image" | "overlay";
  trimStart?: number;
  trimEnd?: number;
  captionChunkId?: string;
  visible?: boolean;
  volume?: number;
  muted?: boolean;
  transform?: ClipTransform;
}

export interface CaptionDocument {
  id: string;
  name: string;
  sourceMediaId?: string;
  languageMode: Language;
  transcript?: {
    segments: AlignedSegment[];
    alignedWords?: AlignedWord[];
    metadata?: Record<string, unknown>;
  };
  originalAlignedWords: AlignedWord[];
  chunks: Caption[];
  style: CaptionStyleConfig;
  chunkingConfig: CaptionChunkingConfig;
  timingConfig: CaptionTimingConfig;
  coverageReport?: CaptionCoverageReport;
}

export type CaptionGapSpeechStatus = "speech" | "silence" | "unknown";

export interface CaptionCoverageChunkSummary {
  id: string;
  start: number;
  end: number;
  text: string;
  wordCount: number;
}

export interface CaptionCoverageGap {
  start: number;
  end: number;
  duration: number;
  previousChunkId?: string;
  nextChunkId?: string;
  previousText?: string;
  nextText?: string;
  wordsInGap: AlignedWord[];
  speechStatus: CaptionGapSpeechStatus;
  audioRms?: number;
  audioPeak?: number;
  warning?: string;
}

export interface CaptionCoverageReport {
  generatedAt: string;
  totalOriginalAlignedWords: number;
  firstWordTime: number | null;
  lastWordTime: number | null;
  chunkCount: number;
  totalCaptionCoverageSeconds: number;
  chunks: CaptionCoverageChunkSummary[];
  largeGaps: CaptionCoverageGap[];
  invalidChunks: {
    chunkId: string;
    start: number;
    end: number;
    reason: string;
  }[];
  overlappingChunks: {
    leftChunkId: string;
    rightChunkId: string;
    overlapSeconds: number;
  }[];
  wordsNotAssigned: AlignedWord[];
  warnings: string[];
}

export interface ProjectData {
  version: string;
  timeline: {
    duration: number;
    tracks: TimelineTrack[];
    clips: TimelineClip[];
  };
  captions: Caption[];
  captionDocuments?: CaptionDocument[];
  settings: {
    language: Language;
    theme: CaptionTheme;
    captionStyleConfig?: CaptionStyleConfig;
    captionChunkingConfig?: CaptionChunkingConfig;
    captionLayerTransform?: CaptionLayerTransform;
    captionTimingConfig?: CaptionTimingConfig;
    sequenceSettings?: SequenceSettings;
    exportSettings?: ExportSettings;
  };
}

export interface TimelineViewState {
  pixelsPerSecond: number;
  scrollLeft: number;
  snapEnabled: boolean;
}

export interface MonitorViewState {
  zoom: number;
  panX: number;
  panY: number;
  mode: "fit" | "fill" | "manual";
}

export interface EditorProject {
  id: string;
  name: string;
  sequence: SequenceSettings;
  duration: number;
  media: MediaFile[];
  captionDocuments: CaptionDocument[];
  tracks: TimelineTrack[];
  selectedClipIds: string[];
  selectedTrackId?: string;
  selectedPanel: RightPanelTab;
  playback: {
    currentTime: number;
    duration: number;
    isPlaying: boolean;
  };
  timelineView: TimelineViewState;
  monitorView: MonitorViewState;
}

export interface PipelineProgress {
  status: string;
  percent: number;
  details: string;
}

export interface JobResponse {
  job_id: string;
  status: string;
  progress: number;
  filename: string;
  target_lang: string;
  languageMode: Language;
  error?: string;
  srt?: string;
  vtt?: string;
  segments?: AlignedSegment[];
  transcript?: {
    languageMode: Language;
    provider?: string;
    romanized?: boolean;
    segments: AlignedSegment[];
    alignedWords?: AlignedWord[];
    metadata?: Record<string, unknown>;
  };
  created_at: string;
  completed_at?: string;
}

export interface AlignedSegment {
  id?: string;
  start: number;
  end: number;
  text: string;
  words?: AlignedWord[];
}

export interface AlignedWord {
  word: string;
  start: number;
  end: number;
  score: number;
  confidence?: number;
  provider?: string;
  timing_source?: string;
  timingSource?: CaptionTimingSource;
  originalWord?: string;
  spokenWord?: string;
  displayedWord?: string;
  languageHint?: "english" | "hindi" | "telugu" | "unknown";
  timing_repair?: string;
  timingWarning?: string;
  timing_warning?: string;
  timingNeedsReview?: boolean;
  timingReviewRequired?: boolean;
  disableActiveWordHighlighting?: boolean;
}

export interface CaptionChunkingConfig {
  maxWordsPerCaption: number;
  minWordsPerCaption: number;
  targetWordsPerCaption: number;
  maxCharsPerCaption: number;
  minCaptionDuration: number;
  maxCaptionDuration: number;
  pauseSplitThreshold: number;
  mergeSmallGapThreshold: number;
  targetReadingSpeedCps: number;
  wordTimingSensitivity: number;
  minWordDuration: number;
  maxHoldAfterWord: number;
  snapToWaveformPeaks: boolean;
  avoidSingleWordCaptions: boolean;
  balanceLineLength: boolean;
}

export interface CaptionTimingConfig {
  globalOffsetSeconds: number;
  wordPreRollSeconds: number;
  wordPostHoldSeconds: number;
  phrasePostHoldSeconds: number;
  pauseClearThresholdSeconds: number;
  preventChunkOverlap: boolean;
  snapChunkStartToFirstWord: boolean;
  snapChunkEndToLastWord: boolean;
}

export interface CaptionLayoutSafetyConfig {
  maxWidthPercent: number;
  maxHeightPercent: number;
  safeMarginPercent: number;
  defaultFontSize: number;
  minFontSize: number;
  maxFontSize: number;
  defaultScale: number;
  minScale: number;
  maxScale: number;
  lineClamp: number;
  wrapMode: "balanced" | "normal" | "none";
}

export interface CaptionLayerTransform {
  xPercent: number;
  yPercent: number;
  scale: number;
  rotation: number;
  opacity: number;
  anchor: "center" | "top" | "bottom";
}

export interface SequenceSettings {
  width: number;
  height: number;
  fps: VideoFrameRate;
  aspectRatio: SequenceAspectRatio;
  resolutionPreset: SequenceResolutionPreset;
  backgroundColor: string;
  safeMarginsEnabled: boolean;
  safeMarginsPercent: number;
  /** Legacy projects stored this as a raw percent. Kept for migration. */
  safeMargins: number;
}

export interface ExportSettings {
  format: "mp4";
  mode: ExportMode;
  resolutionPreset: ExportResolutionPreset;
  width: number;
  height: number;
  aspectRatio: ExportAspectRatio;
  fps: ExportFrameRate;
  quality: ExportQualityPreset;
  bitrate: ExportBitrateMode;
  customBitrateMbps: number;
  includeAudio: boolean;
  visibleTracksOnly: boolean;
  burnCaptions: boolean;
  hardwareAcceleration: boolean;
  backgroundColor: string;
  durationSource: ExportDurationSource;
  customDuration: number;
  /** Legacy UI/API preset. New code resolves real dimensions from the model. */
  resolution?: "480p" | "720p" | "1080p";
}

export type CaptionAlignment = "left" | "center" | "right";
export type CaptionEntranceAnimation = "none" | "hard_cut" | "fade" | "flip" | "pop" | "slide";
export type CaptionWordAnimation = "none" | "pop" | "bounce";
export type CaptionWordEffect = "none" | "reveal" | "highlight" | "bounce" | "paint" | "pop" | "fade";
export type CaptionMaxLines = "auto" | 1 | 2 | 3;
export type KineticAnimateBy = "word" | "letter";

export interface BuildPresetFontSizeConfig {
  bigFontSizePx: number;
  smallFontSizePx: number;
}

export interface CaptionStyleConfig {
  presetName: string;
  fontFamily: string;
  bigFontFamily?: string;
  smallFontFamily?: string;
  fontSize: number;
  fontWeight: number | string;
  textColor: string;
  activeWordColor: string;
  backgroundEnabled: boolean;
  backgroundColor: string;
  backgroundOpacity: number;
  backgroundFit?: "wrap" | "fill";
  borderRadius: number;
  paddingX: number;
  paddingY: number;
  letterSpacing: number;
  lineHeight: number;
  textTransform: "none" | "uppercase";
  textShadowEnabled: boolean;
  textStrokeEnabled: boolean;
  textStrokeColor: string;
  textStrokeWidth: number;
  textShadowColor: string;
  textShadowOpacity: number;
  textShadowBlur: number;
  textShadowDistance: number;
  textShadowAngle: number;
  activeWordScale: number;
  activeWordGlow: boolean;
  activeWordBackgroundEnabled: boolean;
  activeWordBackgroundColor: string;
  activeWordBackgroundOpacity: number;
  activeWordBackgroundPaddingX: number;
  activeWordBackgroundPaddingY: number;
  activeWordBackgroundBorderRadius: number;
  wordEffect: CaptionWordEffect;
  animationType: CaptionWordAnimation;
  animationStrength: number;
  animationSpeed: number;
  animationSmoothness: number;
  entranceAnimation: CaptionEntranceAnimation;
  backgroundShadow: boolean;
  backgroundBorderEnabled: boolean;
  backgroundBorderColor: string;
  backgroundBorderWidth: number;
  backgroundShadowColor: string;
  backgroundShadowOpacity: number;
  backgroundShadowBlur: number;
  backgroundShadowDistance: number;
  backgroundShadowAngle: number;
  safeAreaEnabled: boolean;
  positionX: number;
  positionY: number;
  scale: number;
  rotation: number;
  opacity: number;
  alignment: CaptionAlignment;
  maxWidth: number;
  maxLines: CaptionMaxLines;
  asymmetricScaleEnabled?: boolean;
  asymmetricScaleStrength?: number;
  randomTiltEnabled?: boolean;
  smartHighlightEnabled?: boolean;
  emphasisGreenColor?: string;
  emphasisYellowColor?: string;
  emphasisRedColor?: string;
  revealDuration?: number;
  revealYOffset?: number;
  revealBlur?: number;
  phraseHoldDuration?: number;
  bigFontSizePx?: number;
  smallFontSizePx?: number;
  anchorSizeMultiplier?: number;
  supportSizeMultiplier?: number;
  layoutMode?:
    | "auto"
    | "center_anchor"
    | "left_anchor"
    | "right_anchor"
    | "top_heavy"
    | "bottom_stack"
    | "split_lockup"
    | "a"
    | "b"
    | "c";
  layoutAsymmetry?: number;
  layoutSafeMarginPercent?: number;
  collisionPadding?: number;
  showBuildWordBounds?: boolean;
  tightness?: number;
  hardCutReveal?: boolean;
}

// Theme presets
export const CAPTION_THEMES: Record<CaptionTheme, CaptionStyle> = {
  word_highlight_box: {
    fontSize: 58,
    fontFamily: "'Poppins', 'Inter', Arial, sans-serif",
    color: "#ffffff",
    backgroundColor: "rgba(0,0,0,0.78)",
    bold: true,
    outline: false,
    position: "bottom",
    textTransform: "none",
    letterSpacing: "0",
    borderRadius: "16px",
    padding: "14px 24px",
    shadow: "none",
    animation: "pop",
  },
  kinetic_fade: {
    fontSize: 54,
    fontFamily: "'Poppins', 'Inter', Arial, sans-serif",
    color: "#ffffff",
    backgroundColor: "transparent",
    bold: true,
    outline: false,
    position: "bottom",
    textTransform: "none",
    letterSpacing: "0",
    borderRadius: "12px",
    padding: "10px 18px",
    shadow: "none",
    animation: "fade-in",
  },
  attention_punch: {
    fontSize: 62,
    fontFamily: "'Anton', 'Poppins', Impact, sans-serif",
    color: "#ffffff",
    backgroundColor: "transparent",
    bold: true,
    outline: true,
    outlineColor: "#000000",
    position: "bottom",
    textTransform: "uppercase",
    letterSpacing: "0",
    borderRadius: "8px",
    padding: "8px 16px",
    shadow: "none",
    animation: "pop",
  },
  mrbeast_style: {
    fontSize: 72,
    fontFamily: "'Komika Axis', 'CCSignLanguage', 'Obelix Pro', 'Anton', Impact, 'Arial Black', sans-serif",
    color: "#ffffff",
    backgroundColor: "transparent",
    bold: true,
    outline: true,
    outlineColor: "#000000",
    position: "center",
    textTransform: "uppercase",
    letterSpacing: "0",
    borderRadius: "0",
    padding: "4px 10px",
    shadow: "none",
    animation: "pop",
  },
  apple_cinematic: {
    fontSize: 68,
    fontFamily: "'SF Pro Display', 'Inter', 'Helvetica Neue', Arial, sans-serif",
    color: "#ffffff",
    backgroundColor: "transparent",
    bold: true,
    outline: false,
    position: "center",
    textTransform: "none",
    letterSpacing: "-0.02em",
    borderRadius: "0",
    padding: "0",
    shadow: "none",
    animation: "fade-in",
  },
  modern_minimalist_lockup: {
    fontSize: 112,
    fontFamily: "'Inter', 'Helvetica Neue', 'SF Pro Display', Arial, sans-serif",
    color: "#ffffff",
    backgroundColor: "transparent",
    bold: true,
    outline: false,
    position: "center",
    textTransform: "none",
    letterSpacing: "0",
    borderRadius: "0",
    padding: "0",
    shadow: "none",
    animation: "slide-up",
  },
  viral_word_highlight: {
    fontSize: 64,
    fontFamily: "'Inter', 'Arial Black', sans-serif",
    color: "#ffffff",
    backgroundColor: "rgba(0,0,0,0.88)",
    bold: true,
    outline: true,
    outlineColor: "#000000",
    position: "bottom",
    textTransform: "uppercase",
    letterSpacing: "0",
    borderRadius: "8px",
    padding: "14px 22px",
    shadow: "0 6px 18px rgba(0,0,0,0.65)",
    animation: "pop",
  },
  minimal: {
    fontSize: 24,
    fontFamily: "Inter, sans-serif",
    color: "#ffffff",
    backgroundColor: "rgba(0,0,0,0.6)",
    bold: false,
    outline: false,
    position: "bottom",
    borderRadius: "4px",
    padding: "6px 12px",
    animation: "fade-in",
  },
  viral_shorts: {
    fontSize: 36,
    fontFamily: "'Inter', sans-serif",
    color: "#ffffff",
    backgroundColor: "transparent",
    bold: true,
    outline: true,
    outlineColor: "#000000",
    position: "center",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    animation: "pop",
  },
  cinematic: {
    fontSize: 20,
    fontFamily: "'Georgia', serif",
    color: "#f0e68c",
    backgroundColor: "transparent",
    bold: false,
    outline: true,
    outlineColor: "#000000",
    position: "bottom",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    animation: "fade-in",
  },
  kalakar_fire: {
    fontSize: 40,
    fontFamily: "'Inter', sans-serif",
    color: "#ff6b35",
    backgroundColor: "transparent",
    bold: true,
    outline: true,
    outlineColor: "#000000",
    position: "center",
    textTransform: "uppercase",
    shadow: "0 0 20px rgba(255,107,53,0.8), 0 0 40px rgba(255,107,53,0.4)",
    animation: "pop",
  },
  karaoke_neon: {
    fontSize: 28,
    fontFamily: "'Inter', sans-serif",
    color: "#00ff88",
    backgroundColor: "rgba(0,0,0,0.4)",
    bold: true,
    outline: false,
    position: "bottom",
    borderRadius: "8px",
    padding: "8px 16px",
    shadow: "0 0 10px #00ff88, 0 0 20px #00ff88",
    animation: "glow-pulse",
  },
  dramatic: {
    fontSize: 22,
    fontFamily: "'Georgia', serif",
    color: "#ffffff",
    backgroundColor: "rgba(0,0,0,0.85)",
    bold: false,
    italic: true,
    outline: false,
    position: "bottom",
    borderRadius: "0",
    padding: "10px 20px",
    letterSpacing: "0.08em",
    animation: "fade-in",
  },
  glassmorphism: {
    fontSize: 24,
    fontFamily: "'Inter', sans-serif",
    color: "#ffffff",
    backgroundColor: "rgba(255,255,255,0.1)",
    bold: true,
    outline: false,
    position: "bottom",
    borderRadius: "12px",
    padding: "10px 20px",
    backdropBlur: 12,
    animation: "slide-up",
  },
  retro_vhs: {
    fontSize: 26,
    fontFamily: "'Courier New', monospace",
    color: "#00ffff",
    backgroundColor: "rgba(0,0,0,0.7)",
    bold: true,
    outline: false,
    position: "bottom",
    borderRadius: "0",
    padding: "6px 14px",
    shadow: "3px 3px 0 #ff0066, -1px -1px 0 #00ff66",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    animation: "none",
  },
  neon_glow: {
    fontSize: 30,
    fontFamily: "'Inter', sans-serif",
    color: "#ff00ff",
    backgroundColor: "transparent",
    bold: true,
    outline: false,
    position: "center",
    shadow: "0 0 7px #ff00ff, 0 0 10px #ff00ff, 0 0 21px #ff00ff, 0 0 42px #bc13fe",
    animation: "glow-pulse",
  },
  typewriter: {
    fontSize: 22,
    fontFamily: "'Courier New', monospace",
    color: "#e0e0e0",
    backgroundColor: "rgba(0,0,0,0.75)",
    bold: false,
    outline: false,
    position: "bottom",
    borderRadius: "2px",
    padding: "8px 16px",
    letterSpacing: "0.12em",
    animation: "typewriter",
  },
  comic_pop: {
    fontSize: 34,
    fontFamily: "'Impact', 'Arial Black', sans-serif",
    color: "#ffff00",
    backgroundColor: "transparent",
    bold: true,
    outline: true,
    outlineColor: "#000000",
    position: "center",
    textTransform: "uppercase",
    shadow: "4px 4px 0 #000",
    animation: "pop",
  },
  elegant_serif: {
    fontSize: 22,
    fontFamily: "'Georgia', 'Times New Roman', serif",
    color: "#f5f0e8",
    backgroundColor: "transparent",
    bold: false,
    italic: true,
    outline: true,
    outlineColor: "rgba(0,0,0,0.6)",
    position: "bottom",
    letterSpacing: "0.15em",
    textTransform: "capitalize",
    animation: "fade-in",
  },
  gradient_wave: {
    fontSize: 32,
    fontFamily: "'Inter', sans-serif",
    color: "#ffffff",
    backgroundColor: "transparent",
    bold: true,
    outline: false,
    position: "center",
    gradient: "linear-gradient(90deg, #667eea 0%, #764ba2 50%, #f97316 100%)",
    animation: "slide-up",
  },
  outline_bold: {
    fontSize: 38,
    fontFamily: "'Inter', sans-serif",
    color: "transparent",
    backgroundColor: "transparent",
    bold: true,
    outline: false,
    position: "center",
    textTransform: "uppercase",
    shadow: "none",
    // Render with -webkit-text-stroke
  },
  shadow_3d: {
    fontSize: 34,
    fontFamily: "'Inter', sans-serif",
    color: "#ffffff",
    backgroundColor: "transparent",
    bold: true,
    outline: false,
    position: "center",
    shadow: "1px 1px 0 #555, 2px 2px 0 #444, 3px 3px 0 #333, 4px 4px 0 #222, 5px 5px 5px rgba(0,0,0,0.5)",
    textTransform: "uppercase",
    animation: "pop",
  },
  highlight_box: {
    fontSize: 26,
    fontFamily: "'Inter', sans-serif",
    color: "#000000",
    backgroundColor: "#facc15",
    bold: true,
    outline: false,
    position: "bottom",
    borderRadius: "4px",
    padding: "6px 14px",
    textTransform: "none",
    animation: "slide-up",
  },
};
