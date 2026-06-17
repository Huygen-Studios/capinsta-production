/* Caption utilities for Huygen Caps */

import {
  Caption,
  AlignedSegment,
  AlignedWord,
  CaptionTheme,
  CaptionStyle,
  CAPTION_THEMES,
  CaptionChunkingConfig,
  CaptionTimingConfig,
  CaptionTimingSource,
} from "./types";

let captionIdCounter = 0;
const MIN_SYNTHETIC_WORD_DURATION = 0.04;
const MIN_CAPTION_DURATION = 0.08;
const CAPTION_OVERLAP_EPSILON = 0.001;
const MAX_ALLOWED_GAP_INSIDE_CHUNK_SECONDS = 0.45;
const SYNTHETIC_WORD_TIMING_WARNING = "Estimated word timing was synthesized because this caption has no valid provider word timestamps.";

export const DEFAULT_CAPTION_CHUNKING_CONFIG: CaptionChunkingConfig = {
  targetWordsPerCaption: 4,
  maxWordsPerCaption: 5,
  minWordsPerCaption: 2,
  maxCharsPerCaption: 36,
  minCaptionDuration: 0.8,
  maxCaptionDuration: 3.0,
  pauseSplitThreshold: 0.45,
  mergeSmallGapThreshold: 0.12,
  targetReadingSpeedCps: 17,
  wordTimingSensitivity: 1,
  minWordDuration: 0.06,
  maxHoldAfterWord: 0.12,
  snapToWaveformPeaks: false,
  avoidSingleWordCaptions: true,
  balanceLineLength: true,
};

export const DEFAULT_CAPTION_TIMING_CONFIG: CaptionTimingConfig = {
  globalOffsetSeconds: 0,
  wordPreRollSeconds: 0,
  wordPostHoldSeconds: 0,
  phrasePostHoldSeconds: 0.12,
  pauseClearThresholdSeconds: 0.45,
  preventChunkOverlap: true,
  snapChunkStartToFirstWord: true,
  snapChunkEndToLastWord: true,
};

export function generateCaptionId(): string {
  return `c_${Date.now()}_${++captionIdCounter}`;
}

function roundWordTime(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function tokenizeCaptionText(text: string) {
  return text.trim().split(/\s+/).filter(Boolean);
}

function isCaptionTimingSource(value: unknown): value is CaptionTimingSource {
  return (
    value === "provider" ||
    value === "whisperx" ||
    value === "stable_ts" ||
    value === "vad_adjusted" ||
    value === "manual" ||
    value === "estimated"
  );
}

export function inferWordTimingSource(word: AlignedWord): CaptionTimingSource {
  if (isCaptionTimingSource(word.timingSource)) return word.timingSource;
  const source = String(word.timing_source || word.timingSource || "").toLowerCase();
  if (source.includes("manual")) return "manual";
  if (source.includes("interpolated") || source.includes("estimated") || source.includes("synthetic")) return "estimated";
  if (source.includes("whisperx") || source.includes("forced_align") || source === "aligned") return "whisperx";
  if (source.includes("stable")) return "stable_ts";
  if (source.includes("vad")) return "vad_adjusted";
  if (word.provider || source.includes("provider")) return "provider";
  return "estimated";
}

export function getWordDisplayText(word: AlignedWord) {
  return normalizeDisplayedCaptionText((word.displayedWord || word.word || word.originalWord || "").trim());
}

export function normalizeDisplayedCaptionText(text: string, languageMode?: string) {
  void languageMode;
  return (text || "")
    .replace(/([A-Za-z0-9\u0C00-\u0C7F])[-‐‑‒–—](?=[A-Za-z0-9\u0C00-\u0C7F])/g, "$1 ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function getCaptionDisplayText(caption: Caption) {
  return caption.manuallyEdited ? caption.text : normalizeDisplayedCaptionText(caption.text, caption.lang);
}

export function normalizeCaptionWord(word: AlignedWord): AlignedWord {
  const display = getWordDisplayText(word);
  const original = (word.originalWord || word.word || display).trim();
  const timingSource = inferWordTimingSource(word);
  return {
    ...word,
    word: normalizeDisplayedCaptionText(display || original),
    displayedWord: normalizeDisplayedCaptionText(display || original),
    originalWord: original || display,
    timingSource,
    timing_source: word.timing_source || timingSource,
    timingWarning: word.timingWarning || word.timing_warning,
  };
}

export function normalizeCaptionWords(caption: Caption): AlignedWord[] {
  return (caption.words || [])
    .map(normalizeCaptionWord)
    .filter((word) => getWordDisplayText(word) && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start);
}

function synthesizeCaptionWords(caption: Caption): AlignedWord[] {
  const tokens = tokenizeCaptionText(caption.text || caption.originalText || "");
  const fallbackTokens = tokens.length
    ? tokens
    : normalizeCaptionWords(caption).map(getWordDisplayText).filter(Boolean);
  const start = roundWordTime(Math.max(0, Number.isFinite(caption.start) ? caption.start : 0));
  const end = roundWordTime(Math.max(start + MIN_CAPTION_DURATION, Number.isFinite(caption.end) ? caption.end : start + 1));
  const duration = Math.max(MIN_CAPTION_DURATION, end - start);

  return fallbackTokens.map((token, index) => {
    const wordStart = roundWordTime(start + (duration * index) / Math.max(1, fallbackTokens.length));
    const rawEnd = index === fallbackTokens.length - 1
      ? end
      : start + (duration * (index + 1)) / Math.max(1, fallbackTokens.length);
    return {
      word: token,
      displayedWord: token,
      originalWord: token,
      start: wordStart,
      end: roundWordTime(Math.max(wordStart + MIN_SYNTHETIC_WORD_DURATION, rawEnd)),
      score: 0,
      timing_source: "render_estimated",
      timingSource: "estimated",
      timing_warning: SYNTHETIC_WORD_TIMING_WARNING,
      timingWarning: SYNTHETIC_WORD_TIMING_WARNING,
    };
  });
}

function warnSyntheticRenderableTiming(caption: Caption, reason: string) {
  if (process.env.NODE_ENV === "production") return;
  console.warn("[captions] rendering estimated word timing", {
    captionId: caption.id,
    start: caption.start,
    end: caption.end,
    text: caption.text,
    reason,
  });
}

export function getRenderableCaptionWords(caption: Caption): AlignedWord[] {
  const start = roundWordTime(Math.max(0, Number.isFinite(caption.start) ? caption.start : 0));
  const end = roundWordTime(Math.max(start + MIN_CAPTION_DURATION, Number.isFinite(caption.end) ? caption.end : start + 1));
  const words = normalizeCaptionWords(caption).sort((a, b) => a.start - b.start);

  if (words.length === 0) {
    warnSyntheticRenderableTiming(caption, "caption has no valid words");
    return synthesizeCaptionWords(caption);
  }

  const inRange = words.filter((word) => word.end > start + 0.001 && word.start < end - 0.001);
  if (inRange.length === 0) {
    warnSyntheticRenderableTiming(caption, "caption words are outside caption range");
    return synthesizeCaptionWords(caption);
  }

  return inRange.length ? inRange : synthesizeCaptionWords(caption);
}

function expandTimedWord(word: AlignedWord): AlignedWord[] {
  const cleanText = word.word?.trim();
  if (!cleanText) return [];

  const tokens = cleanText.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1 || word.start === undefined || word.end === undefined || word.end <= word.start) {
    return [normalizeCaptionWord({ ...word, word: cleanText, displayedWord: word.displayedWord || cleanText, originalWord: word.originalWord || cleanText })];
  }

  const duration = word.end - word.start;
  return tokens.map((token, index) => {
    const tokenStart = word.start + (duration * index) / tokens.length;
    const rawTokenEnd = index === tokens.length - 1 ? word.end : word.start + (duration * (index + 1)) / tokens.length;
    return {
      ...word,
      word: token,
      displayedWord: token,
      originalWord: word.originalWord || token,
      start: roundWordTime(tokenStart),
      end: roundWordTime(Math.max(tokenStart + MIN_SYNTHETIC_WORD_DURATION, rawTokenEnd)),
      timing_source: word.timing_source?.includes("interpolated") ? word.timing_source : `${word.timing_source || "segment_word"}_interpolated`,
      timingSource: "estimated",
    };
  });
}

function synthesizeSegmentWords(seg: AlignedSegment): AlignedWord[] {
  const segmentText = seg.text?.trim() || "";
  const segmentTokens = segmentText.split(/\s+/).filter(Boolean);
  if (segmentTokens.length === 0 || seg.end <= seg.start) {
    return [];
  }

  const duration = seg.end - seg.start;
  return segmentTokens.map((token, index) => {
    const tokenStart = seg.start + (duration * index) / segmentTokens.length;
    const rawTokenEnd = index === segmentTokens.length - 1 ? seg.end : seg.start + (duration * (index + 1)) / segmentTokens.length;
    return {
      word: token,
      displayedWord: token,
      originalWord: token,
      start: roundWordTime(tokenStart),
      end: roundWordTime(Math.max(tokenStart + MIN_SYNTHETIC_WORD_DURATION, rawTokenEnd)),
      score: 1,
      timing_source: "segment_interpolated",
      timingSource: "estimated",
    };
  });
}

function getSegmentWords(seg: AlignedSegment): AlignedWord[] {
  const expandedWords = (seg.words || [])
    .flatMap(expandTimedWord)
    .filter((word) => word.word && word.start !== undefined && word.end !== undefined && word.end > word.start);

  const segmentText = seg.text?.trim() || "";
  const segmentTokens = segmentText.split(/\s+/).filter(Boolean);
  const hasCollapsedSentenceWord =
    expandedWords.length === 1 &&
    segmentTokens.length > 1 &&
    expandedWords[0].word.trim() === segmentText;

  if (expandedWords.length > 0 && !hasCollapsedSentenceWord) {
    return expandedWords;
  }

  if (segmentTokens.length > 1) {
    return synthesizeSegmentWords(seg);
  }

  return expandedWords;
}

export function getAlignedWordsFromSegments(segments: AlignedSegment[]): AlignedWord[] {
  return segments
    .flatMap(getSegmentWords)
    .map(normalizeCaptionWord)
    .filter((word) => getWordDisplayText(word) && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function getCaptionPageText(words: AlignedWord[]) {
  return words.map(getWordDisplayText).join(" ");
}

function getCaptionPageDuration(words: AlignedWord[]) {
  if (words.length === 0) return 0;
  return Math.max(0, words[words.length - 1].end - words[0].start);
}

function canMergeCaptionPages(left: AlignedWord[], right: AlignedWord[], options: CaptionChunkingConfig) {
  if (left.length === 0 || right.length === 0) return false;

  const gapSeconds = right[0].start - left[left.length - 1].end;
  const maxGap = Math.max(0, options.mergeSmallGapThreshold ?? DEFAULT_CAPTION_CHUNKING_CONFIG.mergeSmallGapThreshold);
  if (gapSeconds > maxGap) return false;

  const merged = [...left, ...right];
  const mergedText = getCaptionPageText(merged);
  const minWords = Math.max(1, options.minWordsPerCaption);
  const maxWords = Math.max(minWords, options.maxWordsPerCaption);
  const maxDuration = Math.max(MIN_CAPTION_DURATION, options.maxCaptionDuration);

  return (
    merged.length <= maxWords &&
    mergedText.length <= options.maxCharsPerCaption &&
    getCaptionPageDuration(merged) <= maxDuration
  );
}

function shouldMergeCaptionPage(words: AlignedWord[], options: CaptionChunkingConfig) {
  if (words.length === 0) return false;

  const minWords = Math.max(1, options.minWordsPerCaption);
  const minDuration = Math.max(MIN_CAPTION_DURATION, options.minCaptionDuration);

  return (
    (options.avoidSingleWordCaptions && words.length === 1) ||
    words.length < minWords ||
    getCaptionPageDuration(words) < minDuration
  );
}

function finalizeCaptionPages(pages: AlignedWord[][], options: CaptionChunkingConfig) {
  const merged = pages.map((page) => [...page]);

  for (let index = 0; index < merged.length; index += 1) {
    const page = merged[index];
    if (!shouldMergeCaptionPage(page, options)) continue;

    const previous = merged[index - 1];
    if (previous && canMergeCaptionPages(previous, page, options)) {
      merged[index - 1] = [...previous, ...page];
      merged.splice(index, 1);
      index -= 1;
      continue;
    }

    const next = merged[index + 1];
    if (next && canMergeCaptionPages(page, next, options)) {
      merged[index + 1] = [...page, ...next];
      merged.splice(index, 1);
      index -= 1;
    }
  }

  return merged;
}

function buildCaptionFromWordGroup(
  group: AlignedWord[],
  nextWordStart: number | undefined,
  lang: string,
  theme: string,
  options: CaptionChunkingConfig
): Caption {
  const normalizedWords = group.map(normalizeCaptionWord).sort((a, b) => a.start - b.start);
  const usesEstimatedTiming = normalizedWords.some((word) => inferWordTimingSource(word) === "estimated");
  const start = roundWordTime(Math.max(0, normalizedWords[0]?.start ?? 0));
  const lastWordEnd = roundWordTime(Math.max(start + MIN_SYNTHETIC_WORD_DURATION, normalizedWords[normalizedWords.length - 1]?.end ?? start));
  const maxHold = Math.max(0, options.maxHoldAfterWord ?? DEFAULT_CAPTION_CHUNKING_CONFIG.maxHoldAfterWord);
  const holdWindow = Number.isFinite(nextWordStart)
    ? Math.max(0, (nextWordStart as number) - CAPTION_OVERLAP_EPSILON - lastWordEnd)
    : maxHold;
  const end = roundWordTime(Math.max(start + MIN_SYNTHETIC_WORD_DURATION, lastWordEnd + Math.min(maxHold, holdWindow)));

  return {
    id: generateCaptionId(),
    start,
    end,
      text: normalizeDisplayedCaptionText(normalizedWords.map(getWordDisplayText).join(" "), lang),
    originalText: normalizedWords.map((word) => word.originalWord || word.word).join(" "),
    words: normalizedWords,
    lang: lang as Caption["lang"],
    theme: theme as Caption["theme"],
    timingNeedsReview: usesEstimatedTiming || undefined,
    timingWarning: usesEstimatedTiming ? SYNTHETIC_WORD_TIMING_WARNING : undefined,
  };
}

function normalizeCaptionTimeline(captions: Caption[]) {
  const ordered = [...captions].sort((a, b) => a.start - b.start);

  return ordered.map((caption, index) => {
    const next = ordered[index + 1];
    const words = normalizeCaptionWords(caption)
      .map((word) => ({ ...word }))
      .sort((a, b) => a.start - b.start);

    let start = roundWordTime(Math.max(0, caption.start));
    let end = roundWordTime(Math.max(start + MIN_SYNTHETIC_WORD_DURATION, caption.end));
    const lastWordEnd = words.length > 0
      ? roundWordTime(Math.max(start + MIN_SYNTHETIC_WORD_DURATION, words[words.length - 1].end))
      : end;

    if (words.length > 0) {
      start = roundWordTime(Math.max(0, words[0].start));
      end = roundWordTime(Math.max(start + MIN_SYNTHETIC_WORD_DURATION, end));
    }

    if (next && next.start > lastWordEnd && end > next.start) {
      end = roundWordTime(Math.max(lastWordEnd, next.start - CAPTION_OVERLAP_EPSILON));
    }

    return {
      ...caption,
      start,
      end,
      words: words.length ? words : caption.words,
      text: words.length ? normalizeDisplayedCaptionText(words.map(getWordDisplayText).join(" "), caption.lang) : normalizeDisplayedCaptionText(caption.text, caption.lang),
      originalText: words.length
        ? words.map((word) => word.originalWord || word.word).join(" ")
        : caption.originalText,
    };
  });
}

export function captionsToTranscriptSegments(captions: Caption[]): AlignedSegment[] {
  return [...captions]
    .sort((a, b) => a.start - b.start)
    .map((caption) => {
      const words = normalizeCaptionWords(caption);
      const fallbackWords = words.length ? words : synthesizeCaptionWords(caption);
      return {
        id: caption.id,
        start: caption.start,
        end: caption.end,
        text: getCaptionDisplayText(caption),
        words: fallbackWords,
      };
    })
    .filter((segment) => segment.text.trim() && segment.end > segment.start);
}

/**
 * Modern word-group caption conversion.
 * Splits aligned segments into 2-3 word groups, each with per-word timing
 * for word-by-word pop-in animation (like CapCut / MrBeast style).
 */
export function buildCaptionPages(
  words: AlignedWord[],
  options: CaptionChunkingConfig = DEFAULT_CAPTION_CHUNKING_CONFIG
): AlignedWord[][] {
  const pages: AlignedWord[][] = [];
  let current: AlignedWord[] = [];
  const minWords = Math.max(1, options.minWordsPerCaption);
  const maxWords = Math.max(minWords, options.maxWordsPerCaption);
  const targetWords = Math.max(minWords, Math.min(maxWords, options.targetWordsPerCaption ?? DEFAULT_CAPTION_CHUNKING_CONFIG.targetWordsPerCaption));
  const maxChars = Math.max(4, options.maxCharsPerCaption);
  const maxDuration = Math.max(MIN_CAPTION_DURATION, options.maxCaptionDuration);
  const pauseSplitThreshold = Math.max(0, options.pauseSplitThreshold);
  const internalGapThreshold = Math.min(
    Math.max(0, pauseSplitThreshold || MAX_ALLOWED_GAP_INSIDE_CHUNK_SECONDS),
    MAX_ALLOWED_GAP_INSIDE_CHUNK_SECONDS
  );

  const flush = () => {
    if (current.length > 0) {
      pages.push(current);
      current = [];
    }
  };

  for (const word of words) {
    const cleanWord = word.word?.trim();
    if (!cleanWord || word.start === undefined || word.end === undefined || word.end <= word.start) {
      continue;
    }

    const minWordDuration = options.minWordDuration ?? DEFAULT_CAPTION_CHUNKING_CONFIG.minWordDuration;
    const normalizedWord = normalizeCaptionWord({
      ...word,
      word: cleanWord,
      displayedWord: word.displayedWord || cleanWord,
      end: roundWordTime(Math.max(word.end, word.start + minWordDuration)),
    });

    if (current.length === 0) {
      current.push(normalizedWord);
      continue;
    }

    const lastWord = current[current.length - 1];
    const candidate = [...current, normalizedWord];
    const candidateText = getCaptionPageText(candidate);
    const pauseSeconds = Math.max(0, normalizedWord.start - lastWord.end);
    const candidateDuration = getCaptionPageDuration(candidate);
    const readingSpeed = candidateDuration > 0 ? candidateText.length / candidateDuration : 0;
    const splitForPause = pauseSeconds >= pauseSplitThreshold || pauseSeconds > internalGapThreshold;
    const splitForBalance =
      options.balanceLineLength &&
      current.length >= minWords &&
      current.length >= targetWords &&
      candidateText.length > maxChars * 0.92;
    const splitForReadingSpeed =
      current.length >= targetWords &&
      candidateText.length > maxChars &&
      readingSpeed > options.targetReadingSpeedCps * 1.35;
    const shouldSplit =
      current.length >= maxWords ||
      candidateText.length > maxChars ||
      candidateDuration > maxDuration ||
      splitForPause ||
      splitForBalance ||
      splitForReadingSpeed;

    if (shouldSplit) {
      flush();
    }

    current.push(normalizedWord);
  }

  flush();
  return finalizeCaptionPages(pages, options);
}

export function segmentsToCaptions(
  segments: AlignedSegment[],
  lang: string = "english",
  theme: string = "word_highlight_box",
  options: CaptionChunkingConfig = DEFAULT_CAPTION_CHUNKING_CONFIG
): Caption[] {
  const captions: Caption[] = [];
  let timedWordBuffer: AlignedWord[] = [];

  const flushTimedWordBuffer = () => {
    if (timedWordBuffer.length === 0) return;

    const groups = buildCaptionPages(
      [...timedWordBuffer].sort((a, b) => a.start - b.start),
      options
    );

    groups.forEach((group, index) => {
      if (group.length === 0) return;
      captions.push(buildCaptionFromWordGroup(group, groups[index + 1]?.[0]?.start, lang, theme, options));
    });

    timedWordBuffer = [];
  };

  for (const seg of segments) {
    if (!seg.text || !seg.text.trim()) continue;

    const validWords = getSegmentWords(seg);

    if (validWords.length > 0) {
      timedWordBuffer.push(...validWords);
      continue;
    }

    flushTimedWordBuffer();

    captions.push({
      id: generateCaptionId(),
      start: seg.start,
      end: seg.end,
      text: normalizeDisplayedCaptionText(seg.text.trim(), lang),
      originalText: seg.text.trim(),
      lang: lang as Caption["lang"],
      theme: theme as Caption["theme"],
    });
  }

  flushTimedWordBuffer();

  return normalizeCaptionTimeline(captions);
}

export const segmentsToCapptions = segmentsToCaptions;

export function alignedWordsToCaptions(
  words: AlignedWord[],
  lang: string = "english",
  theme: string = "word_highlight_box",
  options: CaptionChunkingConfig = DEFAULT_CAPTION_CHUNKING_CONFIG
): Caption[] {
  const sortedWords = words
    .map(normalizeCaptionWord)
    .filter((word) => getWordDisplayText(word) && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const groups = buildCaptionPages(sortedWords, options);
  return normalizeCaptionTimeline(
    groups
      .filter((group) => group.length > 0)
      .map((group, index) => buildCaptionFromWordGroup(group, groups[index + 1]?.[0]?.start, lang, theme, options))
  );
}

export function getActiveWordIndex(words: AlignedWord[] | undefined, currentTime: number): number {
  if (!words || words.length === 0) return -1;
  return words.findIndex((word) => currentTime >= word.start && currentTime < word.end);
}

export function wordActivationProgressFrames(word: AlignedWord, currentTime: number, fps: number): number {
  return Math.max(0, (currentTime - word.start) * fps);
}

export function applyEditedCaptionText(caption: Caption, nextText: string): Partial<Caption> {
  const text = nextText.trim().replace(/\s+/g, " ");
  const tokens = tokenizeCaptionText(text);
  const currentWords = normalizeCaptionWords(caption);
  const originalText =
    caption.originalText || currentWords.map((word) => word.originalWord || word.word).join(" ") || caption.text;

  if (tokens.length === 0) {
    return {
      text: "",
      words: [],
      originalText,
      manuallyEdited: true,
      timingNeedsReview: true,
      timingWarning: "Caption text is empty.",
    };
  }

  if (currentWords.length > 0 && currentWords.length === tokens.length) {
    const words = currentWords.map((word, index) => ({
      ...word,
      word: tokens[index],
      displayedWord: tokens[index],
      originalWord: word.originalWord || word.word,
      timingSource: word.timingSource || inferWordTimingSource(word),
      timing_source: word.timing_source || word.timingSource || inferWordTimingSource(word),
    }));
    return {
      text,
      words,
      originalText,
      manuallyEdited: true,
      timingNeedsReview: false,
      timingWarning: validateCaptionTiming({ ...caption, text, words, originalText, manuallyEdited: true, timingNeedsReview: false }),
    };
  }

  const duration = Math.max(MIN_CAPTION_DURATION, caption.end - caption.start);
  const wordDuration = duration / tokens.length;
  const words = tokens.map((word, index) => {
    const start = roundWordTime(caption.start + wordDuration * index);
    const rawEnd = index === tokens.length - 1 ? caption.end : caption.start + wordDuration * (index + 1);
    return {
      word,
      displayedWord: word,
      originalWord: currentWords[index]?.originalWord || currentWords[index]?.word || word,
      start,
      end: roundWordTime(Math.max(start + MIN_SYNTHETIC_WORD_DURATION, rawEnd)),
      score: currentWords[index]?.score ?? 0,
      confidence: currentWords[index]?.confidence,
      provider: currentWords[index]?.provider,
      languageHint: currentWords[index]?.languageHint,
      timingSource: "estimated" as CaptionTimingSource,
      timing_source: "estimated",
    };
  });

  return {
    text,
    words,
    originalText,
    manuallyEdited: true,
    timingNeedsReview: true,
    timingWarning: "Word count changed, so word timings were evenly estimated inside this caption.",
  };
}

export function applyManualCaptionTiming(caption: Caption, nextStart: number, nextEnd: number): Caption {
  const start = Math.max(0, Number.isFinite(nextStart) ? nextStart : caption.start);
  const end = Math.max(start + MIN_CAPTION_DURATION, Number.isFinite(nextEnd) ? nextEnd : caption.end);
  const oldDuration = Math.max(MIN_CAPTION_DURATION, caption.end - caption.start);
  const nextDuration = end - start;
  const words = normalizeCaptionWords(caption).map((word) => {
    const relativeStart = Math.max(0, Math.min(1, (word.start - caption.start) / oldDuration));
    const relativeEnd = Math.max(relativeStart, Math.min(1, (word.end - caption.start) / oldDuration));
    const wordStart = roundWordTime(start + relativeStart * nextDuration);
    const wordEnd = roundWordTime(Math.max(wordStart + MIN_SYNTHETIC_WORD_DURATION, start + relativeEnd * nextDuration));
    return {
      ...word,
      start: wordStart,
      end: Math.min(end, wordEnd),
      timingSource: "manual" as CaptionTimingSource,
      timing_source: "manual",
    };
  });

  const nextCaption = {
    ...caption,
    start: roundWordTime(start),
    end: roundWordTime(end),
    words,
    timingNeedsReview: caption.timingNeedsReview,
  };

  return {
    ...nextCaption,
    timingWarning: validateCaptionTiming(nextCaption),
  };
}

export function shiftCaptionTiming(caption: Caption, offsetSeconds: number): Caption {
  const desiredStart = caption.start + offsetSeconds;
  const actualOffset = Math.max(0, desiredStart) - caption.start;
  return applyManualCaptionTiming(caption, caption.start + actualOffset, caption.end + actualOffset);
}

export function applyCaptionTimingOffset(captions: Caption[], offsetSeconds: number): Caption[] {
  const safeOffset = Number.isFinite(offsetSeconds) ? offsetSeconds : 0;
  return captions.map((caption) => {
    const start = roundWordTime(Math.max(0, caption.start + safeOffset));
    const actualOffset = start - caption.start;
    const end = roundWordTime(Math.max(start + MIN_CAPTION_DURATION, caption.end + actualOffset));
    return {
      ...caption,
      start,
      end,
      words: normalizeCaptionWords(caption).map((word) => {
        const wordStart = roundWordTime(Math.max(0, word.start + actualOffset));
        return {
          ...word,
          start: wordStart,
          end: roundWordTime(Math.max(wordStart + MIN_SYNTHETIC_WORD_DURATION, word.end + actualOffset)),
        };
      }),
    };
  });
}

export function validateCaptionTiming(caption: Caption): string | undefined {
  if (!Number.isFinite(caption.start) || !Number.isFinite(caption.end)) return "Caption timing contains an invalid number.";
  if (caption.start < 0) return "Caption starts before 0 seconds.";
  if (caption.end <= caption.start) return "Caption end must be after the start.";

  let previousStart = -Infinity;
  for (const word of normalizeCaptionWords(caption)) {
    if (!Number.isFinite(word.start) || !Number.isFinite(word.end)) return "A word has invalid timing.";
    if (word.start < caption.start - 0.001 || word.end > caption.end + 0.001) return "Word timing is outside the caption range.";
    if (word.end <= word.start) return "A word end time is before its start time.";
    if (word.start < previousStart) return "Word start times are not increasing.";
    previousStart = word.start;
  }

  return caption.timingNeedsReview ? caption.timingWarning : undefined;
}

export function formatTimecode(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * 30); // 30fps frame count
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${pad(m)}:${pad(s)}.${pad(ms)}`;
}

/** Parse "MM:SS.cs", "MM:SS.mmm", or raw seconds back to a number */
export function parseTime(input: string): number | null {
  const match = input.trim().match(/^(\d+):(\d{1,2})\.(\d{1,3})$/);
  if (match) {
    const mins = parseInt(match[1], 10);
    const secs = parseInt(match[2], 10);
    const fraction = parseInt(match[3].padEnd(3, "0"), 10);
    return mins * 60 + secs + fraction / 1000;
  }
  // Try raw seconds
  const num = parseFloat(input);
  if (!isNaN(num) && num >= 0) return num;
  return null;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

export function generateSRT(captions: Caption[]): string {
  return captions
    .sort((a, b) => a.start - b.start)
    .map((c, i) => {
      const startTC = srtTimecode(c.start);
      const endTC = srtTimecode(c.end);
      return `${i + 1}\n${startTC} --> ${endTC}\n${getCaptionDisplayText(c)}\n`;
    })
    .join("\n");
}

function srtTimecode(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${ms.toString().padStart(3, "0")}`;
}

// ── ASS Generation Helpers ──────────────────────────────────────────

// Map CSS hex color → ASS &HAABBGGRR
function hexToAss(hex: string, alpha = 0): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return "&H00FFFFFF";
  const rr = h.slice(0, 2);
  const gg = h.slice(2, 4);
  const bb = h.slice(4, 6);
  return `&H${alpha.toString(16).padStart(2, "0").toUpperCase()}${bb}${gg}${rr}`.toUpperCase();
}

// Map rgba() → ASS BackColour
function rgbaToAss(rgba: string): string {
  const m = rgba.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!m) return "&H00000000";
  const r = parseInt(m[1]).toString(16).padStart(2, "0");
  const g = parseInt(m[2]).toString(16).padStart(2, "0");
  const b = parseInt(m[3]).toString(16).padStart(2, "0");
  const a = m[4] ? Math.round((1 - parseFloat(m[4])) * 255) : 0;
  return `&H${a.toString(16).padStart(2, "0").toUpperCase()}${b.toUpperCase()}${g.toUpperCase()}${r.toUpperCase()}`;
}

// Per-theme highlight color matching CaptionOverlay.tsx
const THEME_HIGHLIGHT_COLORS: Partial<Record<CaptionTheme, string>> = {
  word_highlight_box: "#FFD43B",
  mrbeast_style: "#FFFF00",
  apple_cinematic: "#FFFFFF",
  modern_minimalist_lockup: "#FFFFFF",
  viral_word_highlight: "#22f4b8",
  viral_shorts: "#FFD700",
  kalakar_fire: "#ff6b35",
  karaoke_neon: "#00ff88",
  neon_glow: "#00ffff",
  gradient_wave: "#ff6ec7",
  comic_pop: "#FFD700",
};

/**
 * Build a named ASS style line from a theme (or custom style override).
 */
function buildAssStyle(styleName: string, theme: CaptionTheme, styleOverride?: CaptionStyle): string {
  const t = styleOverride || CAPTION_THEMES[theme] || CAPTION_THEMES.word_highlight_box;
  const font = (t.fontFamily || "Arial").replace(/'/g, "").split(",")[0].trim();
  const size = t.fontSize || 24;
  const bold = t.bold ? -1 : 0;
  const italic = t.italic ? -1 : 0;
  const primary = t.color?.startsWith("#") ? hexToAss(t.color) : "&H00FFFFFF";
  const outlineClr = t.outline && t.outlineColor?.startsWith("#") ? hexToAss(t.outlineColor) : "&H00000000";
  const bg = t.backgroundColor?.startsWith("rgba") ? rgbaToAss(t.backgroundColor)
    : t.backgroundColor?.startsWith("#") ? hexToAss(t.backgroundColor)
    : "&H00000000";
  const borderStyle = (t.backgroundColor && t.backgroundColor !== "transparent") ? 3 : 1;
  const outlineW = t.outline ? 3 : (borderStyle === 1 ? 2 : 0);
  const shadow = borderStyle === 1 ? 1 : 0;
  const align = t.position === "center" ? 5 : t.position === "top" ? 8 : 2;
  const marginV = align === 5 ? 20 : 30;

  return `Style: ${styleName},${font},${size},${primary},&H000000FF,${outlineClr},${bg},${bold},${italic},0,0,100,100,0,0,${borderStyle},${outlineW},${shadow},${align},20,20,${marginV},1`;
}

/**
 * Build karaoke text with \kf tags for word-by-word color highlighting.
 * The active word shows in the theme's highlight color via \1c override.
 */
function buildKaraokeText(caption: Caption): string {
  if (!caption.words || caption.words.length === 0) return getCaptionDisplayText(caption);

  const highlightHex = THEME_HIGHLIGHT_COLORS[caption.theme] || "#FFD700";
  const highlightAss = hexToAss(highlightHex);

  return caption.words.map((w) => {
    const durCs = Math.max(1, Math.round((w.end - w.start) * 100));
    return `{\\kf${durCs}\\1c${highlightAss}}${getWordDisplayText(w)}`;
  }).join(" ");
}

/**
 * Generate ASS subtitle file with per-caption theming and karaoke word highlighting.
 *
 * - Each unique theme → named ASS style (e.g. Theme_viral_shorts, Theme_cinematic)
 * - Custom per-caption overrides → unique style (Custom_0, Custom_1, ...)
 * - Word-level data → \kf karaoke tags with highlight color
 */
export function generateASS(
  captions: Caption[],
  _theme?: CaptionTheme,
  enableKaraoke: boolean = true,
  playRes?: { width: number; height: number }
): string {
  const styleMap = new Map<string, string>(); // styleName → Style line
  const captionStyleNames: string[] = [];
  const playResX = Math.max(1, Math.round(playRes?.width || 1080));
  const playResY = Math.max(1, Math.round(playRes?.height || 1920));

  const sorted = [...captions].sort((a, b) => a.start - b.start);

  sorted.forEach((c, idx) => {
    let styleName: string;

    if (c.style) {
      // Caption has custom per-instance style → unique ASS style
      styleName = `Custom_${idx}`;
      styleMap.set(styleName, buildAssStyle(styleName, c.theme, c.style));
    } else {
      // Shared theme-based style
      styleName = `Theme_${c.theme}`;
      if (!styleMap.has(styleName)) {
        styleMap.set(styleName, buildAssStyle(styleName, c.theme));
      }
    }
    captionStyleNames.push(styleName);
  });

  // Fallback if no captions
  if (styleMap.size === 0) {
    const fb = _theme || "word_highlight_box";
    styleMap.set(`Theme_${fb}`, buildAssStyle(`Theme_${fb}`, fb));
  }

  const styleLines = Array.from(styleMap.values()).join("\n");

  const header = `[Script Info]
Title: Huygen Caps
ScriptType: v4.00+
  PlayResX: ${playResX}
  PlayResY: ${playResY}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleLines}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = sorted
    .map((c, idx) => {
      const start = assTimecode(c.start);
      const end = assTimecode(c.end);
      const sName = captionStyleNames[idx];
      const text = (enableKaraoke && c.words && c.words.length > 0) ? buildKaraokeText(c) : getCaptionDisplayText(c);
      return `Dialogue: 0,${start},${end},${sName},,0,0,0,,${text}`;
    })
    .join("\n");

  return header + events;
}

function assTimecode(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${h}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

export function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Delay revoke so the browser has time to start the download
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
