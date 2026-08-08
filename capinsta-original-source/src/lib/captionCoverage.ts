import {
  AlignedWord,
  Caption,
  CaptionCoverageGap,
  CaptionCoverageReport,
  CaptionGapSpeechStatus,
  MediaFile,
} from "./types";
import { getCaptionDisplayText, getWordDisplayText, normalizeCaptionWords } from "./captionUtils";

const EPSILON_SECONDS = 0.001;
const DEFAULT_LARGE_GAP_THRESHOLD_SECONDS = 1.0;
const SPEECH_RMS_THRESHOLD = 0.008;
const SPEECH_PEAK_THRESHOLD = 0.025;

function roundTime(value: number) {
  return Math.round(value * 1000) / 1000;
}

function cleanWords(words: AlignedWord[]) {
  return words
    .filter((word) => getWordDisplayText(word) && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function wordOverlapsRange(word: AlignedWord, start: number, end: number) {
  return word.end > start + EPSILON_SECONDS && word.start < end - EPSILON_SECONDS;
}

function captionContainsWord(caption: Caption, word: AlignedWord) {
  const midpoint = (word.start + word.end) / 2;
  return midpoint >= caption.start - EPSILON_SECONDS && midpoint < caption.end + EPSILON_SECONDS;
}

export function validateCaptionCoverage(
  captions: Caption[],
  originalAlignedWords: AlignedWord[],
  options: { largeGapThresholdSeconds?: number } = {}
): CaptionCoverageReport {
  const largeGapThresholdSeconds = Math.max(
    0.1,
    options.largeGapThresholdSeconds ?? DEFAULT_LARGE_GAP_THRESHOLD_SECONDS
  );
  const sortedCaptions = [...captions]
    .filter((caption) => Number.isFinite(caption.start) && Number.isFinite(caption.end))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const words = cleanWords(originalAlignedWords);
  const invalidChunks: CaptionCoverageReport["invalidChunks"] = [];
  const overlappingChunks: CaptionCoverageReport["overlappingChunks"] = [];
  const largeGaps: CaptionCoverageGap[] = [];
  const warnings: string[] = [];

  sortedCaptions.forEach((caption) => {
    if (!Number.isFinite(caption.start) || !Number.isFinite(caption.end) || caption.end <= caption.start) {
      invalidChunks.push({
        chunkId: caption.id,
        start: caption.start,
        end: caption.end,
        reason: "Caption has invalid start/end timing.",
      });
    }
  });

  for (let index = 0; index < sortedCaptions.length - 1; index += 1) {
    const current = sortedCaptions[index];
    const next = sortedCaptions[index + 1];
    const overlap = current.end - next.start;

    if (overlap > EPSILON_SECONDS) {
      overlappingChunks.push({
        leftChunkId: current.id,
        rightChunkId: next.id,
        overlapSeconds: roundTime(overlap),
      });
    }

    const gapStart = current.end;
    const gapEnd = next.start;
    const gapDuration = gapEnd - gapStart;
    if (gapDuration <= largeGapThresholdSeconds) continue;

    const wordsInGap = words.filter((word) => wordOverlapsRange(word, gapStart, gapEnd));
    const gap: CaptionCoverageGap = {
      start: roundTime(gapStart),
      end: roundTime(gapEnd),
      duration: roundTime(gapDuration),
      previousChunkId: current.id,
      nextChunkId: next.id,
      previousText: getCaptionDisplayText(current),
      nextText: getCaptionDisplayText(next),
      wordsInGap,
      speechStatus: wordsInGap.length ? "speech" : "unknown",
      warning: wordsInGap.length
        ? `Large caption gap detected: ${roundTime(gapStart)}s to ${roundTime(gapEnd)}s, but ${wordsInGap.length} aligned word(s) exist inside it.`
        : `Large caption gap detected: ${roundTime(gapStart)}s to ${roundTime(gapEnd)}s.`,
    };
    largeGaps.push(gap);
    if (gap.warning) warnings.push(gap.warning);
  }

  const wordsNotAssigned = words.filter((word) => !sortedCaptions.some((caption) => captionContainsWord(caption, word)));
  if (wordsNotAssigned.length) {
    warnings.push(`${wordsNotAssigned.length} aligned word(s) are not assigned to any caption chunk.`);
  }
  if (invalidChunks.length) {
    warnings.push(`${invalidChunks.length} caption chunk(s) have invalid timing.`);
  }
  if (overlappingChunks.length) {
    warnings.push(`${overlappingChunks.length} caption chunk overlap(s) detected.`);
  }

  const firstWordTime = words.length ? roundTime(words[0].start) : null;
  const lastWordTime = words.length ? roundTime(words[words.length - 1].end) : null;

  return {
    generatedAt: new Date().toISOString(),
    totalOriginalAlignedWords: words.length,
    firstWordTime,
    lastWordTime,
    chunkCount: sortedCaptions.length,
    totalCaptionCoverageSeconds: roundTime(
      sortedCaptions.reduce((total, caption) => total + Math.max(0, caption.end - caption.start), 0)
    ),
    chunks: sortedCaptions.map((caption) => ({
      id: caption.id,
      start: roundTime(caption.start),
      end: roundTime(caption.end),
      text: getCaptionDisplayText(caption),
      wordCount: normalizeCaptionWords(caption).length,
    })),
    largeGaps,
    invalidChunks,
    overlappingChunks,
    wordsNotAssigned,
    warnings,
  };
}

function getAudioContextCtor() {
  if (typeof window === "undefined") return null;
  return window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext || null;
}

function readAudioWindowEnergy(audioBuffer: AudioBuffer, start: number, end: number) {
  const sampleRate = audioBuffer.sampleRate;
  const startSample = Math.max(0, Math.floor(start * sampleRate));
  const endSample = Math.min(audioBuffer.length, Math.ceil(end * sampleRate));
  if (endSample <= startSample) return { rms: 0, peak: 0 };

  let peak = 0;
  let sumSquares = 0;
  let count = 0;
  const channels = Math.max(1, audioBuffer.numberOfChannels);
  const step = Math.max(1, Math.floor((endSample - startSample) / 24000));

  for (let channel = 0; channel < channels; channel += 1) {
    const data = audioBuffer.getChannelData(channel);
    for (let sample = startSample; sample < endSample; sample += step) {
      const value = Math.abs(data[sample] || 0);
      peak = Math.max(peak, value);
      sumSquares += value * value;
      count += 1;
    }
  }

  return {
    rms: count > 0 ? Math.sqrt(sumSquares / count) : 0,
    peak,
  };
}

export async function addMediaSpeechToCoverageReport(
  report: CaptionCoverageReport,
  media?: MediaFile | null
): Promise<CaptionCoverageReport> {
  if (!media || report.largeGaps.length === 0) return report;

  const AudioContextCtor = getAudioContextCtor();
  if (!AudioContextCtor) {
    return {
      ...report,
      largeGaps: report.largeGaps.map((gap) => ({ ...gap, speechStatus: gap.speechStatus || "unknown" })),
    };
  }

  const audioContext = new AudioContextCtor();
  try {
    const audioBuffer = await audioContext.decodeAudioData(await media.file.arrayBuffer());
    const largeGaps = report.largeGaps.map((gap) => {
      const energy = readAudioWindowEnergy(audioBuffer, gap.start, gap.end);
      const speechStatus: CaptionGapSpeechStatus =
        energy.peak >= SPEECH_PEAK_THRESHOLD || energy.rms >= SPEECH_RMS_THRESHOLD ? "speech" : "silence";
      const warning =
        speechStatus === "speech" && gap.wordsInGap.length === 0
          ? `Speech detected with no transcript between ${gap.start}s and ${gap.end}s. Regenerate captions.`
          : gap.warning;
      return {
        ...gap,
        speechStatus,
        audioRms: roundTime(energy.rms),
        audioPeak: roundTime(energy.peak),
        warning,
      };
    });
    const warnings = [
      ...report.warnings,
      ...largeGaps
        .filter((gap) => gap.speechStatus === "speech" && gap.wordsInGap.length === 0)
        .map((gap) => gap.warning)
        .filter((warning): warning is string => Boolean(warning)),
    ];
    return { ...report, largeGaps, warnings: Array.from(new Set(warnings)) };
  } catch (error) {
    return {
      ...report,
      warnings: [
        ...report.warnings,
        `Could not decode media audio for gap validation: ${error instanceof Error ? error.message : "unknown error"}.`,
      ],
    };
  } finally {
    await audioContext.close().catch(() => undefined);
  }
}
