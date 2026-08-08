/* CaptionEditorPanel - Kapwing-style subtitles workflow */

"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  Combine,
  Download,
  Eye,
  EyeOff,
  Info,
  Languages,
  MoreVertical,
  Plus,
  Search,
  Scissors,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import {
  alignedWordsToCaptions,
  applyEditedCaptionText,
  captionsToTranscriptSegments,
  getAlignedWordsFromSegments,
  parseTime,
  segmentsToCaptions,
  validateCaptionTiming,
} from "@/lib/captionUtils";
import { addMediaSpeechToCoverageReport, validateCaptionCoverage } from "@/lib/captionCoverage";
import { defaultCaptionTrackId, isCaptionLocked } from "@/lib/editorModel";
import { AlignedSegment, AlignedWord, Caption, CaptionCoverageReport, CaptionDocument, Language } from "@/lib/types";
import { applyCaptionSync, autoFixCaptionSync, cancelJob, getHealth, getJob, previewCaptionSync, runHighQualityAlignment, uploadVideo } from "@/lib/api";
import { useCaptionExport } from "@/hooks/useCaptionExport";
import { useWebSocket } from "@/hooks/useWebSocket";
import { openMediaPicker } from "@/lib/mediaImport";
import { useCaptionStore } from "@/store/captionStore";
import { useEditorStore } from "@/store/editorStore";
import { usePlaybackStore } from "@/store/playbackStore";
import { useTimelineStore } from "@/store/timelineStore";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

interface CaptionEditorPanelProps {
  initialFlow?: "setup" | "list";
}

type OriginalLanguageOption = "auto_detect" | "english" | "telugu" | "hindi" | "auto_mixed_indian" | "hinglish" | "telgish";
type TranslateOption = "same" | "english" | "telugu" | "hindi" | "telgish";

const ORIGINAL_LANGUAGE_OPTIONS: { value: OriginalLanguageOption; label: string }[] = [
  { value: "auto_detect", label: "Auto Detect" },
  { value: "english", label: "English" },
  { value: "telugu", label: "Telugu" },
  { value: "hindi", label: "Hindi" },
  { value: "auto_mixed_indian", label: "Auto Mixed Indian" },
  { value: "hinglish", label: "Hinglish" },
  { value: "telgish", label: "Telgish / Teluglish" },
];

const TRANSLATE_OPTIONS: { value: TranslateOption; label: string; disabled?: boolean }[] = [
  { value: "same", label: "None / Same as original" },
  { value: "english", label: "English" },
  { value: "hindi", label: "Hindi / Hinglish" },
  { value: "telugu", label: "Telugu script (coming later)", disabled: true },
  { value: "telgish", label: "Telgish / Telugu in English letters" },
];

function languageModeFromSelection(original: OriginalLanguageOption, translate: TranslateOption): Language {
  if (translate === "english") return "english";
  if (translate === "hindi") return "hinglish";
  if (translate === "telugu" || translate === "telgish") return "telgish";
  if (original === "english") return "english";
  if (original === "hindi" || original === "hinglish") return "hinglish";
  if (original === "telugu" || original === "telgish") return "telgish";
  return "auto_mixed_indian";
}

function chunkingForChars(chars: number, maxLines: number | "auto" = "auto") {
  const safeChars = Math.max(18, Math.min(160, Math.round(chars)));

  const wordBudget = (maxChars: number, minTarget = 2) => {
    const targetWordsPerCaption = Math.max(minTarget, Math.min(18, Math.round(maxChars / 8)));
    return {
      targetWordsPerCaption,
      maxWordsPerCaption: Math.max(targetWordsPerCaption + 2, Math.min(22, Math.round(maxChars / 6))),
    };
  };

  if (maxLines === 1) {
    return { maxCharsPerCaption: Math.min(safeChars, 34), targetWordsPerCaption: 3, maxWordsPerCaption: 4, maxCaptionDuration: 2.2 };
  }
  if (maxLines === 2) {
    const maxChars = Math.min(Math.max(safeChars, 24), 90);
    return { maxCharsPerCaption: maxChars, ...wordBudget(maxChars, 3), maxCaptionDuration: maxChars >= 72 ? 6.5 : maxChars >= 56 ? 5.2 : 3.6 };
  }
  if (maxLines === 3) {
    const maxChars = Math.min(Math.max(safeChars, 40), 120);
    return { maxCharsPerCaption: maxChars, ...wordBudget(maxChars, 5), maxCaptionDuration: maxChars >= 90 ? 8.0 : 6.5 };
  }
  if (safeChars <= 24) {
    return { maxCharsPerCaption: safeChars, targetWordsPerCaption: 2, maxWordsPerCaption: 3, maxCaptionDuration: 1.8 };
  }
  if (safeChars <= 45) {
    return { maxCharsPerCaption: safeChars, targetWordsPerCaption: 4, maxWordsPerCaption: 6, maxCaptionDuration: 3.2 };
  }
  if (safeChars <= 90) {
    return { maxCharsPerCaption: safeChars, ...wordBudget(safeChars, 5), maxCaptionDuration: safeChars >= 72 ? 6.5 : 5.2 };
  }
  return { maxCharsPerCaption: safeChars, ...wordBudget(safeChars, 8), maxCaptionDuration: 8.0 };
}

function effectiveCharsForLayout(chars: number, maxLines: number | "auto" = "auto") {
  if (maxLines === 1) return Math.min(chars, 34);
  if (maxLines === 2) return Math.min(Math.max(chars, 24), 90);
  if (maxLines === 3) return Math.min(Math.max(chars, 40), 120);
  return chars;
}

function formatSubtitleTime(seconds: number) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60).toString().padStart(2, "0");
  const secs = Math.floor(safe % 60).toString().padStart(2, "0");
  const millis = Math.floor((safe % 1) * 1000).toString().padStart(3, "0");
  return `${minutes}:${secs}.${millis}`;
}

function formatGenerateError(message: string) {
  if (!message) return "";
  const lower = message.toLowerCase();
  if (
    lower.includes("invalid_api_key") ||
    lower.includes("invalid api key") ||
    lower.includes("incorrect api key") ||
    (lower.includes("401") && lower.includes("openai"))
  ) {
    return "OpenAI API key is invalid or missing. Update OPENAI_API_KEY in the backend environment, then restart the server.";
  }
  if (lower.includes("sarvam") && (lower.includes("401") || lower.includes("403") || lower.includes("invalid") || lower.includes("unauthorized"))) {
    return "Sarvam API key is invalid or missing. Update SARVAM_API_KEY in the backend environment, then restart the server.";
  }
  if (message.includes("<!DOCTYPE html") || message.includes("<html")) {
    if (message.includes("This page could not be found") || message.includes("404")) {
      return "Backend API returned a frontend 404 page. Make sure FastAPI is reachable and NEXT_PUBLIC_API_URL is correct.";
    }
    return "Backend returned HTML instead of JSON. Check the backend logs and /api/health.";
  }
  if (process.env.NODE_ENV !== "development" && (message.includes("{'error'") || message.includes('"error"'))) {
    return "Subtitle generation failed. Check backend provider keys and try again.";
  }
  return message.length > 500 ? `${message.slice(0, 500)}...` : message;
}

function tokenizeCaptionForDisplay(caption: Caption) {
  const fromWords = caption.words
    ?.map((word) => (word.displayedWord || word.word || "").trim())
    .filter(Boolean);
  if (fromWords?.length) return fromWords;
  return caption.text
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function resolveActiveWordIndex(caption: Caption, currentTime: number) {
  if (caption.words?.length) {
    const exact = caption.words.findIndex((word) => currentTime >= word.start && currentTime < word.end);
    if (exact >= 0) return exact;
    return -1;
  }

  const fallbackTokens = tokenizeCaptionForDisplay(caption);
  if (!fallbackTokens.length) return -1;
  const duration = Math.max(0.001, caption.end - caption.start);
  const progress = Math.max(0, Math.min(0.999, (currentTime - caption.start) / duration));
  return Math.min(fallbackTokens.length - 1, Math.floor(progress * fallbackTokens.length));
}

function resolveCanonicalSegments(
  captionDocument: CaptionDocument | null,
  transcriptSegments: AlignedSegment[],
  captions: Caption[]
) {
  if (captionDocument?.transcript?.segments?.length) return captionDocument.transcript.segments;
  if (transcriptSegments.length) return transcriptSegments;
  return captionsToTranscriptSegments(captions);
}

function resolveCanonicalWords(
  captionDocument: CaptionDocument | null,
  transcriptSegments: AlignedSegment[],
  captions: Caption[]
) {
  if (captionDocument?.transcript?.alignedWords?.length) return captionDocument.transcript.alignedWords;
  if (captionDocument?.originalAlignedWords?.length) return captionDocument.originalAlignedWords;
  const segmentWords = getAlignedWordsFromSegments(transcriptSegments);
  if (segmentWords.length) return segmentWords;
  return getAlignedWordsFromSegments(captionsToTranscriptSegments(captions));
}

function buildCaptionsFromCanonicalSource(
  words: AlignedWord[],
  segments: AlignedSegment[],
  language: Language,
  theme: string,
  config: Parameters<typeof alignedWordsToCaptions>[3]
) {
  if (words.length) return alignedWordsToCaptions(words, language, theme, config);
  return segmentsToCaptions(segments, language, theme, config);
}

function summarizeCoverageReport(report: CaptionCoverageReport) {
  const suspiciousSpeechGaps = report.largeGaps.filter((gap) => gap.speechStatus === "speech");
  if (suspiciousSpeechGaps.length) {
    const first = suspiciousSpeechGaps[0];
    return `Speech detected but no captions exist from ${first.start}s to ${first.end}s. Regenerate captions.`;
  }
  if (report.largeGaps.length) {
    const first = report.largeGaps[0];
    return `Large caption gap detected: ${first.start}s to ${first.end}s. ${first.speechStatus === "silence" ? "Audio looks silent there." : "Audio status unknown."}`;
  }
  if (report.warnings.length) return report.warnings[0];
  return `Caption coverage OK: ${report.chunkCount} chunks, ${report.totalOriginalAlignedWords} aligned words.`;
}

function InfoDot({ title }: { title: string }) {
  return (
    <span className="inline-flex items-center" title={title}>
      <Info size={12} style={{ color: "var(--text-muted)" }} />
    </span>
  );
}

function CharsPerSubtitleSlider({
  value,
  onChange,
  onCommit,
}: {
  value: number;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const min = 18;
  const max = 160;
  const percent = ((value - min) / (max - min)) * 100;
  const commitFromInput = (event: React.SyntheticEvent<HTMLInputElement>) => {
    onCommit(Number(event.currentTarget.value));
  };

  return (
    <div className="relative pt-7">
      <div
        className="absolute top-0 -translate-x-1/2 rounded px-2 py-1 text-xs font-bold"
        style={{
          left: `${percent}%`,
          background: "#CFF5E4",
          color: "#171217",
          boxShadow: "var(--shadow-hard-small)",
        }}
      >
        {value}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        onMouseUp={commitFromInput}
        onTouchEnd={commitFromInput}
        onKeyUp={(event) => {
          if (event.key === "Enter" || event.key === " ") onCommit(Number(event.currentTarget.value));
        }}
        className="w-full accent-[var(--accent)]"
      />
    </div>
  );
}

export default function CaptionEditorPanel({ initialFlow }: CaptionEditorPanelProps) {
  const {
    language,
    setLanguage,
    mediaFiles,
    activeMediaId,
    setMediaPanelTab,
    pipelineStatus,
    pipelinePercent,
    setJobId,
    jobId,
    setPipelineProgress,
    captionChunkingConfig,
    setCaptionChunkingConfig,
    captionCharsPerSubtitle,
    setCaptionCharsPerSubtitle,
    captionNeedsRebuild,
    setCaptionNeedsRebuild,
    captionStyleConfig,
    captionTimingConfig,
    transcriptSegments,
    setTranscriptSegments,
    theme,
  } = useEditorStore();
  const {
    captions,
    captionDocument,
    selectedIds,
    selectCaption,
    updateCaption,
    addCaption,
    deleteCaption,
    splitCaption,
    mergeCaptions,
    clearAll,
    setCaptions,
    setCaptionDocument,
    setCaptionCoverageReport,
  } = useCaptionStore();
  const { currentTime, showCaptionOverlay, toggleCaptionOverlay, setCurrentTime } = usePlaybackStore();
  const tracks = useTimelineStore((s) => s.tracks);
  const { exportSRT } = useCaptionExport();
  const [flow, setFlow] = useState<"setup" | "list">(
    initialFlow === "setup"
      ? "setup"
      : initialFlow === "list"
      ? captions.length > 0
        ? "list"
        : "setup"
      : captions.length > 0
      ? "list"
      : "setup"
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [captionSearch, setCaptionSearch] = useState("");
  const [originalLanguage, setOriginalLanguage] = useState<OriginalLanguageOption>(
    language === "english" ? "english" : language === "hinglish" ? "hinglish" : language === "telgish" ? "telgish" : "auto_mixed_indian"
  );
  const [translateTo, setTranslateTo] = useState<TranslateOption>("same");
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [editingCaptionId, setEditingCaptionId] = useState<string | null>(null);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [coverageNotice, setCoverageNotice] = useState("");
  const [syncShiftSeconds, setSyncShiftSeconds] = useState(0);
  const [syncSkew, setSyncSkew] = useState(1);
  const [syncAnchorSeconds, setSyncAnchorSeconds] = useState(0);
  const [syncBusy, setSyncBusy] = useState<"" | "preview" | "apply" | "auto" | "align">("");
  const [syncNotice, setSyncNotice] = useState("");
  const [syncReport, setSyncReport] = useState<Record<string, unknown> | null>(null);
  const [lastAutoRecommendation, setLastAutoRecommendation] = useState<{ shiftSeconds: number; skew: number } | null>(null);
  const previewBackupRef = useRef<Caption[] | null>(null);
  const generationRunIdRef = useRef(0);
  const activeUploadAbortRef = useRef<AbortController | null>(null);
  const activePollIntervalRef = useRef<number | null>(null);
  const activeJobIdRef = useRef<string | null>(null);
  const cancelledRunIdsRef = useRef<Set<number>>(new Set());
  const charsPerSubtitle = captionCharsPerSubtitle;
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const lastAutoScrolledCaptionRef = useRef<string | null>(null);

  useWebSocket();

  useEffect(() => {
    return () => {
      activeUploadAbortRef.current?.abort();
      if (activePollIntervalRef.current !== null) {
        window.clearInterval(activePollIntervalRef.current);
      }
      activePollIntervalRef.current = null;
    };
  }, []);

  const activeMedia = mediaFiles.find((file) => file.id === activeMediaId);
  const sortedCaptions = useMemo(() => [...captions].sort((a, b) => a.start - b.start), [captions]);
  const selectedCaptionId = useMemo(() => Array.from(selectedIds)[0] || null, [selectedIds]);
  const captionClockTime = currentTime + captionTimingConfig.globalOffsetSeconds;
  const { activePlaybackChunkId, activePlaybackWordId } = useMemo(() => {
    const activeCaption = sortedCaptions.find((caption) => captionClockTime >= caption.start && captionClockTime <= caption.end) || null;
    if (!activeCaption) {
      return {
        activePlaybackChunkId: null as string | null,
        activePlaybackWordId: null as string | null,
      };
    }

    const activeWordIndexForCaption = resolveActiveWordIndex(activeCaption, captionClockTime);
    return {
      activePlaybackChunkId: activeCaption.id,
      activePlaybackWordId: activeWordIndexForCaption >= 0 ? `${activeCaption.id}:${activeWordIndexForCaption}` : null,
    };
  }, [captionClockTime, sortedCaptions]);
  const visibleCaptions = useMemo(() => {
    const query = captionSearch.trim().toLowerCase();
    if (!query) return sortedCaptions;
    return sortedCaptions.filter((caption) => caption.text.toLowerCase().includes(query));
  }, [captionSearch, sortedCaptions]);
  const estimatedWordCount = useMemo(
    () =>
      captions.reduce(
        (count, caption) =>
          count +
          (caption.words || []).filter((word) => {
            const source = `${word.timing_source || ""} ${word.timingSource || ""}`.toLowerCase();
            return word.timingNeedsReview || word.timingReviewRequired || /estimated|interpolated|synthetic|fallback/.test(source);
          }).length,
        0
      ),
    [captions]
  );

  useEffect(() => {
    if (captions.length > 0 && flow === "setup" && !isGenerating) {
      setFlow("list");
    }
  }, [captions.length, flow, isGenerating]);

  useEffect(() => {
    if (flow !== "list") return;
    if (!activePlaybackChunkId) {
      lastAutoScrolledCaptionRef.current = null;
      return;
    }
    if (lastAutoScrolledCaptionRef.current === activePlaybackChunkId) return;
    if (editingCaptionId) return;

    const focused = document.activeElement;
    if (focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement) return;

    const container = listContainerRef.current;
    const row = rowRefs.current[activePlaybackChunkId];
    if (!container || !row) {
      lastAutoScrolledCaptionRef.current = activePlaybackChunkId;
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const guard = Math.max(16, containerRect.height * 0.1);
    const comfortablyVisible = rowRect.top >= containerRect.top + guard && rowRect.bottom <= containerRect.bottom - guard;

    if (!comfortablyVisible) {
      row.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    }

    lastAutoScrolledCaptionRef.current = activePlaybackChunkId;
  }, [activePlaybackChunkId, editingCaptionId, flow]);

  useEffect(() => {
    if (!editingCaptionId) return;
    const stillExists = captions.some((caption) => caption.id === editingCaptionId);
    if (!stillExists) {
      setEditingCaptionId(null);
    }
  }, [captions, editingCaptionId]);

  const rebuildCaptions = useCallback((requestedChars = charsPerSubtitle) => {
    setIsRebuilding(true);
    const sourceSegments = resolveCanonicalSegments(captionDocument, transcriptSegments, captions);
    const originalAlignedWords = resolveCanonicalWords(captionDocument, sourceSegments, captions);
    if (!sourceSegments.length && !originalAlignedWords.length) {
      setGenerateError("Generate subtitles first before rebuilding.");
      setIsRebuilding(false);
      return;
    }
    const oldChunkCount = captions.length;
    const config = {
      ...captionChunkingConfig,
      ...chunkingForChars(requestedChars, captionStyleConfig.maxLines),
    };
    setCaptionChunkingConfig(config);
    if (!transcriptSegments.length) {
      setTranscriptSegments(sourceSegments);
    }
    const rebuilt = buildCaptionsFromCanonicalSource(originalAlignedWords, sourceSegments, language, theme, config).map((caption) => ({
      ...caption,
      trackId: defaultCaptionTrackId(tracks),
      sourceMediaId: activeMediaId || undefined,
    }));
    const coverageReport = validateCaptionCoverage(rebuilt, originalAlignedWords);
    setCaptions(rebuilt);
    setCaptionDocument({
      id: captionDocument?.id || `caption_document_${Date.now()}`,
      name: activeMedia?.name ? `${activeMedia.name} captions` : "Generated captions",
      sourceMediaId: activeMediaId || captionDocument?.sourceMediaId,
      languageMode: language,
      transcript: { segments: sourceSegments, metadata: captionDocument?.transcript?.metadata },
      originalAlignedWords,
      chunks: rebuilt,
      style: captionStyleConfig,
      chunkingConfig: config,
      timingConfig: captionTimingConfig,
      coverageReport,
    });
    setCaptionCoverageReport(coverageReport);
    setCoverageNotice(summarizeCoverageReport(coverageReport));
    setCaptionNeedsRebuild(false);
    setGenerateError("");
    setIsRebuilding(false);
    if (process.env.NODE_ENV !== "production") {
      console.debug("[captions] rebuild", {
        charsPerSubtitle: requestedChars,
        effectiveMaxChars: config.maxCharsPerCaption,
        maxLines: captionStyleConfig.maxLines,
        sourceWordCount: originalAlignedWords.length,
        oldChunkCount,
        newChunkCount: rebuilt.length,
        coverageWarnings: coverageReport.warnings,
        needsRebuild: false,
      });
    }
  }, [
    activeMedia?.name,
    activeMediaId,
    captionChunkingConfig,
    captionDocument,
    captionStyleConfig,
    captionTimingConfig,
    captions,
    charsPerSubtitle,
    language,
    setCaptionChunkingConfig,
    setCaptionCoverageReport,
    setCaptionDocument,
    setCaptionNeedsRebuild,
    setCaptions,
    setTranscriptSegments,
    theme,
    tracks,
    transcriptSegments,
  ]);

  const handleCancelGenerate = useCallback(() => {
    const runId = generationRunIdRef.current;
    cancelledRunIdsRef.current.add(runId);
    activeUploadAbortRef.current?.abort();
    activeUploadAbortRef.current = null;

    if (activePollIntervalRef.current !== null) {
      window.clearInterval(activePollIntervalRef.current);
      activePollIntervalRef.current = null;
    }

    const jobToCancel = activeJobIdRef.current;
    setIsGenerating(false);
    setPipelineProgress("Cancelled", -1);

    if (jobToCancel) {
      void cancelJob(jobToCancel).catch((error) => {
        if (process.env.NODE_ENV === "development") {
          console.warn("[captions] cancel job failed", error);
        }
      });
    }
  }, [setPipelineProgress]);

  const handleGenerate = useCallback(async () => {
    if (!activeMedia || isGenerating) return;
    if (activeMedia.type !== "video") {
      setGenerateError("Import an MP4 or MOV video before generating subtitles.");
      return;
    }

    if (activePollIntervalRef.current !== null) {
      window.clearInterval(activePollIntervalRef.current);
      activePollIntervalRef.current = null;
    }
    activeUploadAbortRef.current?.abort();
    const runId = generationRunIdRef.current + 1;
    generationRunIdRef.current = runId;
    activeJobIdRef.current = null;
    cancelledRunIdsRef.current.delete(runId);
    const uploadController = new AbortController();
    activeUploadAbortRef.current = uploadController;

    const isCurrentRun = () => generationRunIdRef.current === runId && !cancelledRunIdsRef.current.has(runId);
    const requestedLanguage = languageModeFromSelection(originalLanguage, translateTo);
    setLanguage(requestedLanguage);
    setIsGenerating(true);
    setGenerateError("");
    setPipelineProgress("Checking backend...", 2);

    try {
      const health = await getHealth();
      if (health.dependencies?.ffmpeg !== true) {
        throw new Error("Backend is reachable, but FFmpeg is not available.");
      }
      if (health.dependencies?.ffprobe !== true) {
        throw new Error("Backend is reachable, but FFprobe is not available.");
      }

      setPipelineProgress("Uploading...", 5);
      const result = await uploadVideo(activeMedia.file, requestedLanguage, uploadController.signal);
      if (!isCurrentRun()) return;
      activeUploadAbortRef.current = null;
      activeJobIdRef.current = result.job_id;
      setJobId(result.job_id);

      let pollFailures = 0;
      const pollInterval = window.setInterval(async () => {
        if (!isCurrentRun()) {
          window.clearInterval(pollInterval);
          if (activePollIntervalRef.current === pollInterval) activePollIntervalRef.current = null;
          return;
        }
        try {
          const job = await getJob(result.job_id);
          if (!isCurrentRun()) return;
          pollFailures = 0;
          if (job.status === "completed") {
            window.clearInterval(pollInterval);
            if (activePollIntervalRef.current === pollInterval) activePollIntervalRef.current = null;
            setPipelineProgress("Done", 100);
            const sourceSegments = job.transcript?.segments?.length ? job.transcript.segments : job.segments || [];
            if (sourceSegments.length) {
              setTranscriptSegments(sourceSegments);
              const originalAlignedWords = job.transcript?.alignedWords?.length
                ? job.transcript.alignedWords
                : getAlignedWordsFromSegments(sourceSegments);
              const config = {
                ...useEditorStore.getState().captionChunkingConfig,
                ...chunkingForChars(charsPerSubtitle, useEditorStore.getState().captionStyleConfig.maxLines),
              };
              setCaptionChunkingConfig(config);
              const newCaptions = buildCaptionsFromCanonicalSource(
                originalAlignedWords,
                sourceSegments,
                job.languageMode || requestedLanguage,
                theme,
                config
              ).map((caption) => ({
                ...caption,
                trackId: defaultCaptionTrackId(useTimelineStore.getState().tracks),
                sourceMediaId: activeMedia.id,
              }));
              const coverageReport = validateCaptionCoverage(newCaptions, originalAlignedWords);
              setCaptions(newCaptions);
              setCaptionDocument({
                id: `caption_document_${result.job_id}`,
                name: activeMedia.name ? `${activeMedia.name} captions` : "Generated captions",
                sourceMediaId: activeMedia.id,
                languageMode: job.languageMode || requestedLanguage,
                transcript: { segments: sourceSegments, alignedWords: job.transcript?.alignedWords || originalAlignedWords, metadata: job.transcript?.metadata },
                originalAlignedWords,
                chunks: newCaptions,
                style: useEditorStore.getState().captionStyleConfig,
                chunkingConfig: config,
                timingConfig: useEditorStore.getState().captionTimingConfig,
                coverageReport,
              });
              setCaptionCoverageReport(coverageReport);
              setCoverageNotice(summarizeCoverageReport(coverageReport));
              if (coverageReport.warnings.length && process.env.NODE_ENV !== "production") {
                console.warn("[captions] coverage warnings after generation", coverageReport);
              }
              setFlow("list");
              setCaptionCharsPerSubtitle(charsPerSubtitle);
              setCaptionNeedsRebuild(false);
            }
            setIsGenerating(false);
          } else if (job.status === "cancelled") {
            window.clearInterval(pollInterval);
            if (activePollIntervalRef.current === pollInterval) activePollIntervalRef.current = null;
            cancelledRunIdsRef.current.add(runId);
            setPipelineProgress("Cancelled", -1);
            setIsGenerating(false);
          } else if (job.status === "failed") {
            window.clearInterval(pollInterval);
            if (activePollIntervalRef.current === pollInterval) activePollIntervalRef.current = null;
            setPipelineProgress("Failed", -1);
            setGenerateError(job.error || "Subtitle generation failed.");
            setIsGenerating(false);
          } else {
            setPipelineProgress(job.status || "Processing", Math.max(0, job.progress || 0));
          }
        } catch (error) {
          if (!isCurrentRun()) return;
          pollFailures += 1;
          setGenerateError(error instanceof Error ? error.message : "Failed to read job status.");
          if (pollFailures >= 3) {
            window.clearInterval(pollInterval);
            if (activePollIntervalRef.current === pollInterval) activePollIntervalRef.current = null;
            setPipelineProgress("Error", -1);
            setIsGenerating(false);
          }
        }
      }, 2000);
      activePollIntervalRef.current = pollInterval;
    } catch (error) {
      activeUploadAbortRef.current = null;
      if (!isCurrentRun()) {
        setPipelineProgress("Cancelled", -1);
        setIsGenerating(false);
        return;
      }
      setPipelineProgress("Error", -1);
      setGenerateError(error instanceof Error ? error.message : "Upload failed.");
      setIsGenerating(false);
    }
  }, [
    activeMedia,
    charsPerSubtitle,
    isGenerating,
    originalLanguage,
    setCaptionChunkingConfig,
    setCaptionCharsPerSubtitle,
    setCaptionCoverageReport,
    setCaptionDocument,
    setCaptionNeedsRebuild,
    setCaptions,
    setJobId,
    setLanguage,
    setPipelineProgress,
    setTranscriptSegments,
    theme,
    translateTo,
  ]);

  const handleRowSelect = useCallback(
    (captionId: string, start: number) => {
      if (!useCaptionStore.getState().selectedIds.has(captionId)) {
        selectCaption(captionId);
      }
      setCurrentTime(Math.max(0, start - captionTimingConfig.globalOffsetSeconds));
    },
    [captionTimingConfig.globalOffsetSeconds, selectCaption, setCurrentTime]
  );

  const updateCaptionText = useCallback(
    (captionId: string, value: string) => {
      const caption = captions.find((candidate) => candidate.id === captionId);
      if (!caption || isCaptionLocked(caption, tracks)) return;
      updateCaption(captionId, applyEditedCaptionText(caption, value));
    },
    [captions, tracks, updateCaption]
  );

  const updateCaptionTime = useCallback(
    (captionId: string, field: "start" | "end", value: string) => {
      const parsed = parseTime(value);
      if (parsed === null) return;
      updateCaption(captionId, { [field]: parsed });
    },
    [updateCaption]
  );

  const handleDeleteCaption = useCallback(
    (captionId: string) => {
      deleteCaption(captionId);
      setEditingCaptionId((current) => (current === captionId ? null : current));
    },
    [deleteCaption]
  );

  const handleSplitCaption = useCallback(
    (caption: Caption) => {
      if (isCaptionLocked(caption, tracks)) return;
      splitCaption(caption.id, caption.start + Math.max(0.1, (caption.end - caption.start) / 2));
    },
    [splitCaption, tracks]
  );

  const handleMergeCaption = useCallback(
    (caption: Caption) => {
      const selected = Array.from(useCaptionStore.getState().selectedIds);
      if (selected.length > 1) {
        mergeCaptions(selected);
        return;
      }

      const currentIndex = sortedCaptions.findIndex((candidate) => candidate.id === caption.id);
      const previous = currentIndex > 0 ? sortedCaptions[currentIndex - 1] : null;
      if (previous) {
        mergeCaptions([previous.id, caption.id]);
      }
    },
    [mergeCaptions, sortedCaptions]
  );

  const syncPayload = useCallback(
    () => ({
      shiftSeconds: syncShiftSeconds,
      skew: syncSkew,
      anchorSeconds: syncAnchorSeconds,
      startRange: null,
      endRange: null,
    }),
    [syncAnchorSeconds, syncShiftSeconds, syncSkew]
  );

  const applySyncedSegmentsToEditor = useCallback(
    (segments: unknown[] | undefined) => {
      if (!segments?.length) return;
      const alignedSegments = segments as AlignedSegment[];
      const nextCaptions = segmentsToCaptions(alignedSegments, language, theme, captionChunkingConfig).map((caption) => ({
        ...caption,
        trackId: defaultCaptionTrackId(tracks),
        sourceMediaId: activeMediaId || undefined,
      }));
      setTranscriptSegments(alignedSegments);
      setCaptions(nextCaptions);
      setCaptionDocument({
        id: captionDocument?.id || `caption_document_${Date.now()}`,
        name: captionDocument?.name || "Synced captions",
        sourceMediaId: activeMediaId || captionDocument?.sourceMediaId,
        languageMode: language,
        transcript: { segments: alignedSegments, alignedWords: alignedSegments.flatMap((segment) => segment.words || []) },
        originalAlignedWords: alignedSegments.flatMap((segment) => segment.words || []),
        chunks: nextCaptions,
        style: captionStyleConfig,
        chunkingConfig: captionChunkingConfig,
        timingConfig: captionTimingConfig,
        coverageReport: captionDocument?.coverageReport,
      });
    },
    [
      activeMediaId,
      captionChunkingConfig,
      captionDocument,
      captionStyleConfig,
      captionTimingConfig,
      language,
      setCaptionDocument,
      setCaptions,
      setTranscriptSegments,
      theme,
      tracks,
    ]
  );

  const previewSync = useCallback(async () => {
    if (!jobId) {
      setSyncNotice("Generate captions before previewing sync.");
      return;
    }
    setSyncBusy("preview");
    setSyncNotice("");
    try {
      if (!previewBackupRef.current) previewBackupRef.current = captions;
      const response = await previewCaptionSync(jobId, syncPayload());
      applySyncedSegmentsToEditor(response.segments);
      setSyncReport(response.report || null);
      setSyncNotice("Preview applied in editor only.");
    } catch (error) {
      setSyncNotice(error instanceof Error ? error.message : "Sync preview failed.");
    } finally {
      setSyncBusy("");
    }
  }, [applySyncedSegmentsToEditor, captions, jobId, syncPayload]);

  const applyManualSync = useCallback(async () => {
    if (!jobId) {
      setSyncNotice("Generate captions before applying sync.");
      return;
    }
    setSyncBusy("apply");
    setSyncNotice("");
    try {
      const response = await applyCaptionSync(jobId, syncPayload());
      previewBackupRef.current = null;
      applySyncedSegmentsToEditor(response.segments);
      setSyncReport(response.report || null);
      setSyncNotice("Manual sync saved.");
    } catch (error) {
      setSyncNotice(error instanceof Error ? error.message : "Apply sync failed.");
    } finally {
      setSyncBusy("");
    }
  }, [applySyncedSegmentsToEditor, jobId, syncPayload]);

  const applyAutoRecommendationAnyway = useCallback(async () => {
    if (!jobId || !lastAutoRecommendation) {
      setSyncNotice("Run Auto Fix Sync first to get a recommendation.");
      return;
    }
    setSyncBusy("apply");
    setSyncNotice("");
    try {
      const response = await applyCaptionSync(jobId, {
        shiftSeconds: lastAutoRecommendation.shiftSeconds,
        skew: lastAutoRecommendation.skew,
        anchorSeconds: syncAnchorSeconds,
        startRange: null,
        endRange: null,
      });
      previewBackupRef.current = null;
      applySyncedSegmentsToEditor(response.segments);
      setSyncReport(response.report || null);
      setSyncNotice("Unsafe recommendation applied and saved.");
    } catch (error) {
      setSyncNotice(error instanceof Error ? error.message : "Applying recommendation failed.");
    } finally {
      setSyncBusy("");
    }
  }, [applySyncedSegmentsToEditor, jobId, lastAutoRecommendation, syncAnchorSeconds]);

  const autoFixSync = useCallback(async () => {
    if (!jobId) {
      setSyncNotice("Generate captions before auto sync.");
      return;
    }
    setSyncBusy("auto");
    setSyncNotice("");
    try {
      const response = await autoFixCaptionSync(jobId);
      if (response.applied) {
        previewBackupRef.current = null;
        applySyncedSegmentsToEditor(response.segments);
        setLastAutoRecommendation(null);
        setSyncNotice("Auto sync saved.");
      } else {
        const rec = (response.recommendation || response.report?.recommendation) as Record<string, unknown> | undefined;
        const shift = Number(rec?.shiftSeconds ?? response.report?.shiftSeconds ?? 0);
        const skew = Number(rec?.skew ?? response.report?.skew ?? 1);
        setLastAutoRecommendation({ shiftSeconds: shift, skew });
        setSyncNotice(`${response.userMessage || response.report?.userMessage || "Auto Sync skipped."} Recommended correction: shift ${shift >= 0 ? "+" : ""}${shift.toFixed(3)}s, skew ${skew.toFixed(4)}.`);
      }
      setSyncReport(response.report || null);
    } catch (error) {
      setSyncNotice(error instanceof Error ? error.message : "Auto sync failed.");
    } finally {
      setSyncBusy("");
    }
  }, [applySyncedSegmentsToEditor, jobId]);

  const highQualityAlign = useCallback(async () => {
    if (!jobId) {
      setSyncNotice("Generate captions before running High Quality Alignment.");
      return;
    }
    setSyncBusy("align");
    setSyncNotice("");
    try {
      const response = await runHighQualityAlignment(jobId);
      if (!response.applied) {
        setSyncReport(response.report || null);
        setSyncNotice(response.userMessage || (response.report?.userMessage as string) || "High Quality Alignment did not apply.");
        return;
      }
      previewBackupRef.current = null;
      applySyncedSegmentsToEditor(response.segments);
      setLastAutoRecommendation(null);
      setSyncReport(response.report || null);
      const estimated = Number(response.estimatedWordCount ?? response.report?.estimatedWordCount ?? 0);
      setSyncNotice(estimated > 0 ? `High Quality Alignment saved. ${estimated} estimated word timings remain.` : "High Quality Alignment saved. Word timings look aligned.");
    } catch (error) {
      setSyncNotice(error instanceof Error ? error.message : "High Quality Alignment failed.");
    } finally {
      setSyncBusy("");
    }
  }, [applySyncedSegmentsToEditor, jobId]);

  const resetSyncPreview = useCallback(() => {
    if (previewBackupRef.current) {
      setCaptions(previewBackupRef.current);
      previewBackupRef.current = null;
    }
    setSyncShiftSeconds(0);
    setSyncSkew(1);
    setSyncAnchorSeconds(0);
    setSyncNotice("Sync preview reset.");
    setSyncReport(null);
    setLastAutoRecommendation(null);
  }, [setCaptions]);

  const resetSubtitleState = useCallback(() => {
    if (activePollIntervalRef.current !== null) {
      window.clearInterval(activePollIntervalRef.current);
      activePollIntervalRef.current = null;
    }
    activeUploadAbortRef.current?.abort();
    activeUploadAbortRef.current = null;
    generationRunIdRef.current += 1;
    clearAll();
    setCaptionDocument(null);
    setCaptionCoverageReport(null);
    setTranscriptSegments([]);
    setCaptionNeedsRebuild(false);
    setCaptionSearch("");
    setGenerateError("");
    setCoverageNotice("");
    setSyncNotice("");
    setSyncReport(null);
    setLastAutoRecommendation(null);
    previewBackupRef.current = null;
    setIsGenerating(false);
    setPipelineProgress("", 0);
    setFlow("setup");
    setShowResetDialog(false);
  }, [
    clearAll,
    setCaptionCoverageReport,
    setCaptionDocument,
    setCaptionNeedsRebuild,
    setPipelineProgress,
    setTranscriptSegments,
  ]);

  const addSubtitleLine = useCallback(() => {
    addCaption({
      start: captionClockTime,
      end: captionClockTime + 2,
      text: "",
      lang: language,
      theme,
      trackId: defaultCaptionTrackId(tracks),
      sourceMediaId: activeMediaId || undefined,
      timingNeedsReview: true,
      timingWarning: "New subtitle line needs text and timing review.",
    });
    setFlow("list");
  }, [activeMediaId, addCaption, captionClockTime, language, theme, tracks]);

  const handleCharsChange = useCallback(
    (value: number) => {
      setCaptionCharsPerSubtitle(value);
      setCaptionChunkingConfig({ ...captionChunkingConfig, ...chunkingForChars(value, captionStyleConfig.maxLines) });
      setCaptionNeedsRebuild(Boolean(transcriptSegments.length || captions.length));
      if (process.env.NODE_ENV !== "production") {
        console.debug("[captions] chars changed", {
          oldCharsPerSubtitle: charsPerSubtitle,
          newCharsPerSubtitle: value,
          needsRebuild: Boolean(transcriptSegments.length || captions.length),
          maxLines: captionStyleConfig.maxLines,
        });
      }
    },
    [captionChunkingConfig, captionStyleConfig.maxLines, captions.length, charsPerSubtitle, setCaptionCharsPerSubtitle, setCaptionChunkingConfig, setCaptionNeedsRebuild, transcriptSegments.length]
  );

  const runCaptionCoverageValidation = useCallback(async () => {
    if (!captions.length) {
      setCoverageNotice("Generate subtitles first before validating coverage.");
      return;
    }

    const sourceSegments = resolveCanonicalSegments(captionDocument, transcriptSegments, captions);
    const originalAlignedWords = resolveCanonicalWords(captionDocument, sourceSegments, captions);
    const baseReport = validateCaptionCoverage(captions, originalAlignedWords);
    const enrichedReport = await addMediaSpeechToCoverageReport(baseReport, activeMedia);
    setCaptionCoverageReport(enrichedReport);
    setCaptionDocument({
      id: captionDocument?.id || `caption_document_${Date.now()}`,
      name: captionDocument?.name || (activeMedia?.name ? `${activeMedia.name} captions` : "Generated captions"),
      sourceMediaId: activeMediaId || captionDocument?.sourceMediaId,
      languageMode: language,
      transcript: { segments: sourceSegments, metadata: captionDocument?.transcript?.metadata },
      originalAlignedWords,
      chunks: captions,
      style: captionStyleConfig,
      chunkingConfig: captionChunkingConfig,
      timingConfig: captionTimingConfig,
      coverageReport: enrichedReport,
    });
    setCoverageNotice(summarizeCoverageReport(enrichedReport));
    console.info("[captions] coverage validation", {
      currentTime,
      captionClockTime,
      activeChunkId: activePlaybackChunkId,
      previousChunk:
        sortedCaptions
          .filter((caption) => caption.end <= captionClockTime)
          .at(-1) || null,
      nextChunk: sortedCaptions.find((caption) => caption.start > captionClockTime) || null,
      report: enrichedReport,
    });
  }, [
    activeMedia,
    activeMediaId,
    activePlaybackChunkId,
    captionChunkingConfig,
    captionClockTime,
    captionDocument,
    captionStyleConfig,
    captionTimingConfig,
    captions,
    currentTime,
    language,
    setCaptionCoverageReport,
    setCaptionDocument,
    sortedCaptions,
    transcriptSegments,
  ]);

  const setupPanel = (
    <div className="flex h-full flex-col">
      <div className="panel-header justify-center">
        <span>Subtitles</span>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {captions.length > 0 && (
          <button className="btn-ghost inline-flex items-center gap-1" onClick={() => setFlow("list")}>
            <ChevronLeft size={13} />
            Back to subtitle rows
          </button>
        )}

        <label className="grid gap-2 text-xs" style={{ color: "var(--text-primary)" }}>
          <span className="flex items-center justify-between">
            Original language
            <InfoDot title="Choose the language spoken in the video. Use Auto Mixed Indian for Telugu + English or Hindi + English speech." />
          </span>
          <select
            className="control-input"
            value={originalLanguage}
            onChange={(event) => setOriginalLanguage(event.target.value as OriginalLanguageOption)}
          >
            {ORIGINAL_LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="grid gap-2 text-xs" style={{ color: "var(--text-primary)" }}>
          <span className="flex items-center justify-between">
            Translate video to
            <InfoDot title="Choose if captions should stay in the same language or be translated/romanized." />
          </span>
          <select
            className="control-input"
            value={translateTo}
            onChange={(event) => setTranslateTo(event.target.value as TranslateOption)}
          >
            {TRANSLATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
            ))}
          </select>
        </label>

        {translateTo !== "same" && (
          <button className="btn-ghost flex w-full items-center justify-center gap-2" type="button">
            <Languages size={14} />
            Edit Translation Rules
          </button>
        )}

        {!activeMedia && (
          <button
            className="btn-ghost flex w-full items-center justify-center gap-2"
            onClick={() => {
              setMediaPanelTab("project");
              void openMediaPicker();
            }}
          >
            <Plus size={14} />
            Import Video
          </button>
        )}

        <button
          id="generate-captions-btn"
          className="btn-primary flex w-full items-center justify-center gap-2 py-3"
          onClick={handleGenerate}
          disabled={!activeMedia || isGenerating}
          title="Generates editable subtitles using speech recognition and timing alignment."
        >
          <Wand2 size={15} />
          {isGenerating ? "Generating..." : "Auto Subtitle"}
        </button>

        {isGenerating && (
          <button className="btn-ghost w-full" onClick={handleCancelGenerate}>
            Cancel
          </button>
        )}

        {pipelinePercent > 0 && pipelinePercent < 100 && (
          <div className="space-y-1">
            <div className="flex justify-between text-[10px]" style={{ color: "var(--text-muted)" }}>
              <span>{pipelineStatus}</span>
              <span>{pipelinePercent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--range-track)" }}>
              <div className="h-full transition-all duration-300" style={{ width: `${pipelinePercent}%`, background: "var(--accent)" }} />
            </div>
          </div>
        )}

        {generateError && (
          <div className="editor-notice error whitespace-pre-wrap">
            {formatGenerateError(generateError)}
          </div>
        )}

        <div className="brutal-box p-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
          <div className="mb-1 flex items-center gap-2 font-bold uppercase" style={{ color: "var(--text-primary)" }}>
            <Sparkles size={13} style={{ color: "var(--accent)" }} />
            Caption workflow
          </div>
          Import a video, choose the spoken language, pick an output mode, then generate editable subtitle rows.
        </div>
      </div>
    </div>
  );

  const listPanel = (
    <div className="flex h-full flex-col">
      <div className="panel-header justify-center">
        <span>Subtitles</span>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
        <span className="text-[10px] font-bold uppercase" style={{ color: "var(--text-muted)" }}>
          {captions.length} row{captions.length === 1 ? "" : "s"}
        </span>
        <div className="min-w-0 flex-1" />
        <button className="icon-button" onClick={exportSRT} title="Download SRT" disabled={!captions.length}>
          <Download size={15} />
        </button>
        <button className="icon-button" onClick={toggleCaptionOverlay} title="Preview subtitles">
          {showCaptionOverlay ? <Eye size={15} /> : <EyeOff size={15} />}
        </button>
        <button className="btn-ghost inline-flex items-center gap-1 text-[10px]" onClick={() => setShowResetDialog(true)} disabled={!captions.length} title="Reset all subtitles">
          <Trash2 size={13} />
          Reset
        </button>
        <button className="icon-button" title="More">
          <MoreVertical size={15} />
        </button>
      </div>

      <div className="shrink-0 space-y-2 border-b p-3" style={{ borderColor: "var(--border)" }}>
        <label className="flex min-w-0 items-center gap-2 rounded px-2 py-2" style={{ background: "var(--bg-control)", border: "1px solid var(--border)" }}>
          <Search size={13} className="shrink-0" style={{ color: "var(--text-muted)" }} />
          <input
            className="w-full border-0 bg-transparent text-xs outline-none"
            value={captionSearch}
            placeholder="Search subtitles"
            onChange={(event) => setCaptionSearch(event.target.value)}
            style={{ color: "var(--text-primary)" }}
          />
        </label>
        <details className="brutal-box p-2">
          <summary className="cursor-pointer text-[10px] font-bold uppercase" style={{ color: "var(--text-primary)" }}>
            Subtitle timing tools
          </summary>
          <div className="mt-2 grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <label className="flex flex-1 items-center gap-2 text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>
            <span>Chars per subtitle:</span>
            <InfoDot title="Controls how much text appears in each subtitle block. Lower values create faster shorter captions. Higher values create longer subtitle blocks. Requires Rebuild Subtitles." />
          </label>
        </div>
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <CharsPerSubtitleSlider value={charsPerSubtitle} onChange={handleCharsChange} onCommit={handleCharsChange} />
          <button className="btn-ghost text-[10px]" title="Smart tools are coming later">
            Smart tools
          </button>
        </div>
        <button
          className="btn-ghost w-full text-[10px]"
          type="button"
          disabled={!captions.length}
          onClick={() => void runCaptionCoverageValidation()}
        >
          Validate Caption Coverage
        </button>
        {captionNeedsRebuild && (
          <div className="editor-notice flex items-center justify-between gap-2">
            <span>Subtitle length changed. Click Rebuild Subtitles to apply.</span>
            <button id="rebuild-captions-btn" className="btn-primary" disabled={isRebuilding} onClick={() => rebuildCaptions(charsPerSubtitle)}>
              {isRebuilding ? "Rebuilding..." : "Rebuild Subtitles"}
            </button>
          </div>
        )}
        {captionStyleConfig.maxLines === 1 && charsPerSubtitle > 34 && (
          <div className="editor-notice">
            {charsPerSubtitle} chars may not fit one line. Rebuild will split into shorter one-line captions around {effectiveCharsForLayout(charsPerSubtitle, captionStyleConfig.maxLines)} chars.
          </div>
        )}
        {coverageNotice && (
          <div className="editor-notice compact flex items-center gap-1.5" title={coverageNotice}>
            <AlertTriangle size={12} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{coverageNotice}</span>
          </div>
        )}
        {estimatedWordCount > 0 && (
          <div className="editor-notice error compact flex items-center gap-1.5">
            <AlertTriangle size={12} className="shrink-0" />
            <span className="min-w-0 flex-1">
              {estimatedWordCount} word timing{estimatedWordCount === 1 ? " is" : "s are"} estimated; sync cannot be guaranteed. Use High Quality Alignment.
            </span>
          </div>
        )}
        <div className="brutal-box grid gap-2 p-2">
          <div className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase" style={{ color: "var(--text-primary)" }}>
            <span>Timing & Sync</span>
          </div>
          <label className="grid gap-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
            <span>Global offset {syncShiftSeconds.toFixed(2)}s</span>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.01}
              value={syncShiftSeconds}
              onChange={(event) => setSyncShiftSeconds(Number(event.target.value))}
              className="w-full accent-[var(--accent)]"
            />
          </label>
          <div className="grid grid-cols-3 gap-1">
            {[-0.2, -0.1, -0.05, 0.05, 0.1, 0.2].map((delta) => (
              <button
                key={delta}
                className="btn-ghost px-1 py-1 text-[10px]"
                type="button"
                onClick={() => setSyncShiftSeconds((value) => Math.max(-1, Math.min(1, Number((value + delta).toFixed(2)))))}
              >
                {delta > 0 ? "+" : ""}{delta.toFixed(2)}s
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
              <span>Speed/skew</span>
              <input
                className="control-input h-8"
                type="number"
                min={0.97}
                max={1.03}
                step={0.0001}
                value={syncSkew}
                onChange={(event) => setSyncSkew(Math.max(0.97, Math.min(1.03, Number(event.target.value) || 1)))}
              />
            </label>
            <label className="grid gap-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
              <span>Anchor</span>
              <input
                className="control-input h-8"
                type="number"
                min={0}
                step={0.01}
                value={syncAnchorSeconds}
                onChange={(event) => setSyncAnchorSeconds(Math.max(0, Number(event.target.value) || 0))}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <button className="btn-primary col-span-2 text-[10px]" type="button" disabled={!captions.length || syncBusy !== ""} onClick={highQualityAlign}>
              {syncBusy === "align" ? "Aligning..." : "Run High Quality Alignment"}
            </button>
            <button className="btn-ghost text-[10px]" type="button" disabled={!captions.length || syncBusy !== ""} onClick={previewSync}>
              {syncBusy === "preview" ? "Previewing..." : "Preview Sync"}
            </button>
            <button className="btn-primary text-[10px]" type="button" disabled={!captions.length || syncBusy !== ""} onClick={applyManualSync}>
              {syncBusy === "apply" ? "Saving..." : "Apply Manual Sync"}
            </button>
            <button className="btn-ghost text-[10px]" type="button" disabled={!captions.length || syncBusy !== ""} onClick={autoFixSync}>
              {syncBusy === "auto" ? "Checking..." : "Auto Fix Sync"}
            </button>
            <button
              className="btn-ghost text-[10px]"
              type="button"
              disabled={!captions.length || syncBusy !== "" || !lastAutoRecommendation}
              onClick={applyAutoRecommendationAnyway}
              title="Unsafe when word timings are estimated"
            >
              Apply Recommendation Anyway
            </button>
            <button className="btn-ghost text-[10px]" type="button" disabled={syncBusy !== ""} onClick={resetSyncPreview}>
              Reset Sync
            </button>
          </div>
          {(syncNotice || syncReport) && (
            <div className="editor-notice compact grid gap-1 text-[10px]">
              {syncNotice && <span>{syncNotice}</span>}
              {syncReport && (
                <span>
                  {Boolean(syncReport.applied) ? "Applied" : "Not applied"} / shift {Number(syncReport.shiftSeconds || 0).toFixed(3)}s / skew {Number(syncReport.skew || 1).toFixed(4)} / quality {Number(syncReport.quality || 0).toFixed(3)}
                </span>
              )}
            </div>
          )}
        </div>
          </div>
        </details>
      </div>

      {generateError && (
        <div className="mx-3 mt-3 editor-notice error whitespace-pre-wrap">
          {formatGenerateError(generateError)}
        </div>
      )}

      <div ref={listContainerRef} className="min-h-0 flex-1 overflow-y-auto bg-white text-black">
        {visibleCaptions.length === 0 ? (
          <div className="p-6 text-center text-xs text-neutral-500">
            {captions.length > 0 ? "No matching subtitles" : "No subtitle rows yet."}
          </div>
        ) : (
          visibleCaptions.map((caption) => {
            const locked = isCaptionLocked(caption, tracks);
            const timingWarning = validateCaptionTiming(caption);
            const selected = selectedCaptionId === caption.id;
            const playbackActive = activePlaybackChunkId === caption.id;
            const canMerge = Array.from(selectedIds).length > 1 || sortedCaptions.findIndex((candidate) => candidate.id === caption.id) > 0;
            const duration = Math.max(0, caption.end - caption.start);
            return (
              <div
                key={caption.id}
                data-active-word-id={playbackActive ? activePlaybackWordId || undefined : undefined}
                ref={(node) => {
                  if (node) {
                    rowRefs.current[caption.id] = node;
                  } else {
                    delete rowRefs.current[caption.id];
                  }
                }}
                className="grid cursor-pointer gap-2 border-b px-3 py-2 text-xs"
                style={{
                  gridTemplateColumns: "1fr auto",
                  background: playbackActive ? "#F2E8FF" : selected ? "#FFF7C7" : "#FFFFFF",
                  borderColor: playbackActive ? "#A855F7" : "#ECECEC",
                  boxShadow: playbackActive ? "inset 4px 0 0 #A855F7" : selected ? "inset 4px 0 0 #F5B21A" : undefined,
                }}
                onClick={() => handleRowSelect(caption.id, caption.start)}
              >
                <div className="min-w-0 space-y-2">
                  <textarea
                    className="min-h-16 w-full resize-y rounded border px-2 py-1 text-sm leading-relaxed outline-none disabled:opacity-60"
                    style={{ borderColor: playbackActive ? "#A855F7" : "#D9D9D9", background: "#FFFFFF", color: "#111111" }}
                    value={caption.text}
                    disabled={locked}
                    onClick={(event) => event.stopPropagation()}
                    onFocus={() => {
                      setEditingCaptionId(caption.id);
                      handleRowSelect(caption.id, caption.start);
                    }}
                    onBlur={() => {
                      setEditingCaptionId((current) => (current === caption.id ? null : current));
                    }}
                    onChange={(event) => updateCaptionText(caption.id, event.target.value)}
                    placeholder="Subtitle text"
                  />
                  <div className="grid grid-cols-3 gap-2">
                    <label className="grid gap-1 text-[10px] font-semibold uppercase text-neutral-500">
                      Start
                      <input
                        key={`${caption.id}-start-${caption.start}`}
                        className="rounded border border-neutral-300 bg-white px-1 py-1 font-mono text-[11px] text-neutral-900 outline-none"
                        defaultValue={formatSubtitleTime(caption.start)}
                        disabled={locked}
                        onClick={(event) => event.stopPropagation()}
                        onFocus={() => setEditingCaptionId(caption.id)}
                        onBlur={(event) => {
                          updateCaptionTime(caption.id, "start", event.target.value);
                          setEditingCaptionId((current) => (current === caption.id ? null : current));
                        }}
                        title="Start time"
                      />
                    </label>
                    <label className="grid gap-1 text-[10px] font-semibold uppercase text-neutral-500">
                      End
                      <input
                        key={`${caption.id}-end-${caption.end}`}
                        className="rounded border border-neutral-300 bg-white px-1 py-1 font-mono text-[11px] text-neutral-900 outline-none"
                        defaultValue={formatSubtitleTime(caption.end)}
                        disabled={locked}
                        onClick={(event) => event.stopPropagation()}
                        onFocus={() => setEditingCaptionId(caption.id)}
                        onBlur={(event) => {
                          updateCaptionTime(caption.id, "end", event.target.value);
                          setEditingCaptionId((current) => (current === caption.id ? null : current));
                        }}
                        title="End time"
                      />
                    </label>
                    <div className="grid gap-1 text-[10px] font-semibold uppercase text-neutral-500">
                      Duration
                      <div className="rounded border border-neutral-200 bg-neutral-50 px-1 py-1 font-mono text-[11px] text-neutral-700">
                        {duration.toFixed(2)}s
                      </div>
                    </div>
                  </div>
                  {(caption.timingNeedsReview || timingWarning) && (
                    <div className="flex items-center gap-1 text-[11px] text-amber-600" title={timingWarning || caption.timingWarning || "Needs review"}>
                      <AlertTriangle size={13} />
                      <span className="truncate">{timingWarning || caption.timingWarning || "Needs review"}</span>
                    </div>
                  )}
                </div>
                <div className="flex w-8 flex-col items-center gap-1">
                  <button className="icon-button" type="button" title="Split subtitle" disabled={locked || duration <= 0.2} onClick={(event) => { event.stopPropagation(); handleSplitCaption(caption); }}>
                    <Scissors size={13} />
                  </button>
                  <button className="icon-button" type="button" title="Merge subtitle" disabled={locked || !canMerge} onClick={(event) => { event.stopPropagation(); handleMergeCaption(caption); }}>
                    <Combine size={13} />
                  </button>
                  <button className="icon-button" type="button" title="Delete subtitle" disabled={locked} onClick={(event) => { event.stopPropagation(); handleDeleteCaption(caption.id); }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="shrink-0 border-t p-3" style={{ borderColor: "var(--border)", background: "var(--bg-monitor-controls)" }}>
        <button className="btn-ghost flex w-full items-center justify-center gap-2" onClick={addSubtitleLine}>
          <Plus size={14} />
          Add New Subtitle Line
        </button>
      </div>
    </div>
  );

  return (
    <>
      {captions.length === 0 && flow === "setup" ? setupPanel : listPanel}
      <ConfirmDialog
        open={showResetDialog}
        title="Reset all subtitles?"
        body="This will remove all generated and edited subtitle rows. This cannot be undone."
        confirmLabel="Reset Subtitles"
        destructive
        onCancel={() => setShowResetDialog(false)}
        onConfirm={resetSubtitleState}
      />
    </>
  );
}
