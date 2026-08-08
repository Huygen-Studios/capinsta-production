"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Palette, RotateCcw } from "lucide-react";
import { alignedWordsToCaptions, captionsToTranscriptSegments, getAlignedWordsFromSegments, segmentsToCaptions } from "@/lib/captionUtils";
import { validateCaptionCoverage } from "@/lib/captionCoverage";
import { BUILD_BIG_FONT_SIZE_PX, BUILD_SMALL_FONT_SIZE_PX, CREATOR_FONTS, DEFAULT_WORD_HIGHLIGHT_BOX_CONFIG } from "@/lib/captionStyleConfig";
import { CAPTION_PRESET_LIST, PRESET_CAPABILITIES, getCaptionStylePreset } from "@/lib/captionStylePresets";
import { defaultCaptionTrackId, isCaptionLocked } from "@/lib/editorModel";
import { CaptionAlignment, CaptionEntranceAnimation, CaptionStyleConfig, CaptionStylePresetId, CaptionWordAnimation } from "@/lib/types";
import { useCaptionStore } from "@/store/captionStore";
import { useEditorStore } from "@/store/editorStore";
import { useTimelineStore } from "@/store/timelineStore";

const SWATCHES = ["#000000", "#FFFFFF", "#FF5A5F", "#FFD43B", "#6CC24A", "#1687D9", "#A970FF"];
const OUTLINE_OPTIONS = [
  { label: "None", width: 0 },
  { label: "Thin", width: 2 },
  { label: "Medium", width: 5 },
  { label: "Thick", width: 8 },
];
const ANIMATION_CARDS: {
  label: string;
  value: CaptionWordAnimation;
  patch: Partial<CaptionStyleConfig>;
  preview: "plain" | "highlight" | "paint";
}[] = [
  { label: "None", value: "none", preview: "plain", patch: { wordEffect: "none", animationType: "none", entranceAnimation: "none", activeWordBackgroundEnabled: false } },
  { label: "Reveal", value: "pop", preview: "plain", patch: { wordEffect: "reveal", animationType: "none", entranceAnimation: "none", animationStrength: 0.45, activeWordBackgroundEnabled: false } },
  { label: "Highlight", value: "pop", preview: "highlight", patch: { wordEffect: "highlight", animationType: "pop", entranceAnimation: "none", animationStrength: 0.9, activeWordBackgroundEnabled: true, activeWordBackgroundOpacity: 1, backgroundEnabled: false } },
  { label: "Bounce", value: "bounce", preview: "plain", patch: { wordEffect: "bounce", animationType: "bounce", entranceAnimation: "none", animationStrength: 1, activeWordBackgroundEnabled: false } },
  { label: "Paint", value: "pop", preview: "paint", patch: { wordEffect: "paint", animationType: "none", entranceAnimation: "none", animationStrength: 0.55, activeWordBackgroundEnabled: false } },
  { label: "Pop", value: "pop", preview: "plain", patch: { wordEffect: "pop", animationType: "pop", entranceAnimation: "none", animationStrength: 1.2, activeWordBackgroundEnabled: false } },
  { label: "Fade", value: "none", preview: "plain", patch: { wordEffect: "fade", animationType: "none", entranceAnimation: "fade", activeWordBackgroundEnabled: false } },
];
const TRANSITION_CARDS: {
  label: string;
  value: CaptionEntranceAnimation;
  preview: "none" | "fade" | "flip" | "pop" | "slide";
}[] = [
  { label: "None", value: "none", preview: "none" },
  { label: "Fade", value: "fade", preview: "fade" },
  { label: "Flip", value: "flip", preview: "flip" },
  { label: "Pop", value: "pop", preview: "pop" },
  { label: "Slide", value: "slide", preview: "slide" },
];
const MAX_LINE_OPTIONS: { label: string; value: CaptionStyleConfig["maxLines"] }[] = [
  { label: "Auto", value: "auto" },
  { label: "1 line", value: 1 },
  { label: "2 lines", value: 2 },
  { label: "3 lines", value: 3 },
];
const BUILD_LAYOUT_OPTIONS: { label: string; value: NonNullable<CaptionStyleConfig["layoutMode"]> }[] = [
  { label: "Auto", value: "auto" },
  { label: "Center", value: "center_anchor" },
  { label: "Left Anchor", value: "left_anchor" },
  { label: "Right Anchor", value: "right_anchor" },
];

function chunkingPatchForMaxLines(maxLines: CaptionStyleConfig["maxLines"], currentMaxChars: number) {
  const safeChars = Math.max(18, Math.min(160, Math.round(currentMaxChars)));

  const wordBudget = (maxChars: number, minTarget = 2) => {
    const targetWordsPerCaption = Math.max(minTarget, Math.min(18, Math.round(maxChars / 8)));
    return {
      targetWordsPerCaption,
      maxWordsPerCaption: Math.max(targetWordsPerCaption + 2, Math.min(22, Math.round(maxChars / 6))),
    };
  };

  if (maxLines === 1) {
    return {
      maxCharsPerCaption: Math.min(safeChars, 34),
      targetWordsPerCaption: 3,
      maxWordsPerCaption: 4,
      maxCaptionDuration: 2.2,
    };
  }
  if (maxLines === 2) {
    const maxChars = Math.min(Math.max(safeChars, 24), 90);
    return {
      maxCharsPerCaption: maxChars,
      ...wordBudget(maxChars, 3),
      maxCaptionDuration: maxChars >= 72 ? 6.5 : maxChars >= 56 ? 5.2 : 3.6,
    };
  }
  if (maxLines === 3) {
    const maxChars = Math.min(Math.max(safeChars, 40), 120);
    return {
      maxCharsPerCaption: maxChars,
      ...wordBudget(maxChars, 5),
      maxCaptionDuration: maxChars >= 90 ? 8.0 : 6.5,
    };
  }
  return {};
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-b pb-4" style={{ borderColor: "var(--border)" }}>
      <div className="text-[11px] font-bold uppercase" style={{ color: "var(--text-primary)" }}>
        {title}
      </div>
      {children}
    </section>
  );
}

function SliderControl({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-1">
      <span className="flex items-center justify-between text-[11px]" style={{ color: "var(--text-muted)" }}>
        <span>{label}</span>
        <span>{Number(value).toFixed(step < 1 ? 2 : 0)}{suffix}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="accent-[var(--accent)]"
      />
    </label>
  );
}

function ColorInput({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value || "#000000");
  const validHex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
  const partialHex = /^#?[0-9a-f]{0,6}$/i;

  useEffect(() => {
    setDraft(value || "#000000");
  }, [value]);

  const normalizeHex = (raw: string) => {
    const withHash = raw.startsWith("#") ? raw : `#${raw}`;
    if (!validHex.test(withHash)) return value;
    const hex = withHash.slice(1);
    const expanded = hex.length === 3 ? hex.split("").map((char) => `${char}${char}`).join("") : hex;
    return `#${expanded.toUpperCase()}`;
  };

  const commitIfValid = (raw: string) => {
    const withHash = raw.startsWith("#") ? raw : `#${raw}`;
    if (validHex.test(withHash)) onChange(normalizeHex(withHash));
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={validHex.test(value) ? normalizeHex(value) : "#000000"}
          disabled={disabled}
          onChange={(event) => {
            const next = normalizeHex(event.target.value);
            setDraft(next);
            onChange(next);
          }}
          className="h-8 w-10 rounded border-0 bg-transparent"
        />
        <input
          value={draft}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}`;
            if (!partialHex.test(next)) return;
            setDraft(next);
            commitIfValid(next);
          }}
          onBlur={() => {
            const normalized = normalizeHex(draft);
            setDraft(normalized);
            if (validHex.test(normalized)) onChange(normalized);
          }}
          className="control-input h-8 min-h-0 flex-1 py-1 text-xs"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {SWATCHES.map((swatch) => (
          <button
            key={swatch}
            type="button"
            disabled={disabled}
            className="h-5 w-5 rounded border"
            style={{ background: swatch, borderColor: value.toUpperCase() === swatch ? "var(--accent)" : "var(--border)" }}
            title={swatch}
            onClick={() => onChange(swatch)}
          />
        ))}
      </div>
    </div>
  );
}

function UnavailableNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="editor-notice compact" style={{ background: "var(--bg-panel-raised)", color: "var(--text-muted)" }}>
      {children}
    </div>
  );
}

function PreviewCard({
  label,
  selected,
  disabled,
  activeColor,
  mode,
  onClick,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  activeColor: string;
  mode: "plain" | "highlight" | "paint" | "none" | "fade" | "flip" | "pop" | "slide";
  onClick: () => void;
}) {
  const words = ["YOUR", "SUBTITLES", "HERE"];
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="grid gap-1 text-center"
      title={label}
      style={{ opacity: disabled ? 0.45 : 1 }}
    >
      <div
        className="grid aspect-square place-items-center rounded"
        style={{
          background: selected ? "rgba(169,112,255,0.18)" : "#242424",
          border: selected ? "2px solid var(--accent)" : "1px solid var(--border)",
          boxShadow: selected ? "var(--shadow-hard-small)" : "none",
          filter: mode === "fade" ? "blur(3px)" : "none",
          transform: mode === "flip" ? "perspective(180px) rotateY(-18deg)" : mode === "pop" ? "scale(1.04)" : "none",
        }}
      >
        <div
          className="text-[15px] font-black leading-[1.08]"
          style={{
            color: "#fff",
            textShadow: "0 2px 0 #000",
            transform: mode === "slide" ? "translateY(-5px)" : "none",
          }}
        >
          {words.map((word, index) => (
            <div key={word}>
              <span
                style={{
                  color: mode === "paint" && index < 2 ? activeColor : "#fff",
                  background: mode === "highlight" && index === 1 ? activeColor : "transparent",
                  padding: mode === "highlight" && index === 1 ? "0 3px" : 0,
                }}
              >
                {word}
              </span>
            </div>
          ))}
        </div>
      </div>
      <span className="text-xs" style={{ color: "var(--text-primary)" }}>{label}</span>
    </button>
  );
}

export default function CaptionStylePanel() {
  const {
    captionStyleConfig,
    theme,
    setCaptionStyleConfig,
    resetCaptionStyleConfig,
    applyCaptionStylePreset,
    captionChunkingConfig,
    setCaptionChunkingConfig,
    captionCharsPerSubtitle,
    captionTimingConfig,
    setCaptionNeedsRebuild,
    activeMediaId,
    language,
    transcriptSegments,
    setTranscriptSegments,
  } = useEditorStore();
  const captions = useCaptionStore((s) => s.captions);
  const captionDocument = useCaptionStore((s) => s.captionDocument);
  const selectedIds = useCaptionStore((s) => s.selectedIds);
  const setCaptions = useCaptionStore((s) => s.setCaptions);
  const setCaptionDocument = useCaptionStore((s) => s.setCaptionDocument);
  const setCaptionCoverageReport = useCaptionStore((s) => s.setCaptionCoverageReport);
  const setThemeForAll = useCaptionStore((s) => s.setThemeForAll);
  const tracks = useTimelineStore((s) => s.tracks);
  const [maxLinesNotice, setMaxLinesNotice] = useState("");
  const isBuildPreset = theme === "modern_minimalist_lockup";
  const activePresetId = theme as CaptionStylePresetId;
  const capabilities = PRESET_CAPABILITIES[activePresetId] || PRESET_CAPABILITIES.word_highlight_box;

  const locked =
    captions.some((caption) => selectedIds.has(caption.id) && isCaptionLocked(caption, tracks)) ||
    Boolean(captions.length && tracks.find((track) => track.type === "caption")?.locked);
  const backgroundUnavailable = !capabilities.background;
  const backgroundControlsDisabled = locked || backgroundUnavailable || !captionStyleConfig.backgroundEnabled;
  const backgroundBorderDisabled = locked || !capabilities.backgroundBorder || backgroundUnavailable || !captionStyleConfig.backgroundEnabled;

  const update = useCallback(
    (patch: Partial<CaptionStyleConfig>) => {
      if (locked) return;
      setCaptionStyleConfig(patch);
    },
    [locked, setCaptionStyleConfig]
  );

  const applyPreset = useCallback(
    (presetId: CaptionStylePresetId) => {
      if (locked) return;
      applyCaptionStylePreset(presetId);
      setThemeForAll(presetId);
    },
    [applyCaptionStylePreset, locked, setThemeForAll]
  );

  const updateMaxLines = useCallback(
    (maxLines: CaptionStyleConfig["maxLines"]) => {
      update({ maxLines });
      setCaptionChunkingConfig({
        ...captionChunkingConfig,
        ...chunkingPatchForMaxLines(maxLines, captionCharsPerSubtitle),
      });
      if (captions.length) {
        setCaptionNeedsRebuild(true);
        setMaxLinesNotice("Max lines changed. Rebuild subtitles for best results.");
      }
    },
    [captionCharsPerSubtitle, captionChunkingConfig, captions.length, setCaptionChunkingConfig, setCaptionNeedsRebuild, update]
  );

  const rebuildForMaxLines = useCallback(() => {
    const sourceSegments =
      captionDocument?.transcript?.segments?.length ? captionDocument.transcript.segments : transcriptSegments.length ? transcriptSegments : captionsToTranscriptSegments(captions);
    const originalAlignedWords = captionDocument?.originalAlignedWords?.length
      ? captionDocument.originalAlignedWords
      : getAlignedWordsFromSegments(sourceSegments).length
      ? getAlignedWordsFromSegments(sourceSegments)
      : getAlignedWordsFromSegments(captionsToTranscriptSegments(captions));
      if (!sourceSegments.length && !originalAlignedWords.length) {
      setMaxLinesNotice("Generate subtitles first before rebuilding.");
      return;
    }

    const config = {
      ...captionChunkingConfig,
      ...chunkingPatchForMaxLines(captionStyleConfig.maxLines, captionCharsPerSubtitle),
    };
    setCaptionChunkingConfig(config);
    if (!transcriptSegments.length) {
      setTranscriptSegments(sourceSegments);
    }
    const beforeSignature = captions.map((caption) => `${caption.start.toFixed(3)}-${caption.end.toFixed(3)}:${caption.text}`).join("|");
    const rebuilt = (originalAlignedWords.length
      ? alignedWordsToCaptions(originalAlignedWords, language, theme, config)
      : segmentsToCaptions(sourceSegments, language, theme, config)
    ).map((caption) => ({
        ...caption,
        trackId: defaultCaptionTrackId(tracks),
        sourceMediaId: activeMediaId || undefined,
      }));
    const afterSignature = rebuilt.map((caption) => `${caption.start.toFixed(3)}-${caption.end.toFixed(3)}:${caption.text}`).join("|");
    if (beforeSignature === afterSignature) {
      setMaxLinesNotice("No rebuild needed for current captions.");
      setCaptionNeedsRebuild(false);
      return;
    }
    const coverageReport = validateCaptionCoverage(rebuilt, originalAlignedWords);
    setCaptions(rebuilt);
    setCaptionDocument({
      id: captionDocument?.id || `caption_document_${Date.now()}`,
      name: captionDocument?.name || "Generated captions",
      sourceMediaId: activeMediaId || captionDocument?.sourceMediaId,
      languageMode: language,
      transcript: { segments: sourceSegments, alignedWords: captionDocument?.transcript?.alignedWords, metadata: captionDocument?.transcript?.metadata },
      originalAlignedWords,
      chunks: rebuilt,
      style: captionStyleConfig,
      chunkingConfig: config,
      timingConfig: captionTimingConfig,
      coverageReport,
    });
    setCaptionCoverageReport(coverageReport);
    setCaptionNeedsRebuild(false);
    setMaxLinesNotice(`Subtitles rebuilt for ${captionStyleConfig.maxLines === "auto" ? "auto" : captionStyleConfig.maxLines} line layout.`);
  }, [
    activeMediaId,
    captionChunkingConfig,
    captionCharsPerSubtitle,
    captionDocument,
    captionStyleConfig,
    captions,
    captionTimingConfig,
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

  const outlineLabel = OUTLINE_OPTIONS.find((option) => option.width === captionStyleConfig.textStrokeWidth)?.label || "Custom";

  return (
    <div className="flex h-full flex-col">
      <div className="panel-header justify-between">
        <span className="flex items-center gap-2">
          <Palette size={14} style={{ color: "var(--accent)" }} />
          Caption Style
        </span>
        <button
          className="icon-button"
          title="Reset style"
          disabled={locked}
          onClick={() => {
            resetCaptionStyleConfig(activePresetId);
            setThemeForAll(activePresetId);
          }}
        >
          <RotateCcw size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {locked && (
          <div className="editor-notice">
            Unlock the caption track to edit subtitle styling.
          </div>
        )}

        <Section title="Preset">
          <div className="grid grid-cols-2 gap-2">
            {CAPTION_PRESET_LIST.map((preset) => (
              <button
                key={preset.id}
                className={theme === preset.id ? "btn-primary text-xs" : "btn-ghost text-xs"}
                disabled={locked}
                onClick={() => applyPreset(preset.id)}
                title={preset.description}
              >
                {preset.name.replace(" Style", "").replace(" Cinematic", "").replace("Modern Minimalist ", "")}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Text">
          <label className="grid gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
            <span>Font</span>
            <select
              className="control-input"
              value={captionStyleConfig.fontFamily}
              disabled={locked}
              onChange={(event) => update({ fontFamily: event.target.value })}
            >
              {CREATOR_FONTS.map((font) => (
                <option key={font} value={font}>{font}</option>
              ))}
            </select>
          </label>

          <SliderControl disabled={locked} label="Font weight" value={Number(captionStyleConfig.fontWeight) || 900} min={100} max={1000} step={50} onChange={(fontWeight) => update({ fontWeight })} />

          <div className="grid grid-cols-3 gap-2">
            {(["left", "center", "right"] as CaptionAlignment[]).map((alignment) => (
              <button
                key={alignment}
                className={captionStyleConfig.alignment === alignment ? "btn-primary" : "btn-ghost"}
                disabled={locked}
                onClick={() => update({ alignment })}
              >
                {alignment}
              </button>
            ))}
          </div>

          {capabilities.maxLines && (
            <>
              <SliderControl disabled={locked} label="Font size" value={captionStyleConfig.fontSize} min={8} max={120} onChange={(fontSize) => update({ fontSize })} />
              <SliderControl disabled={locked} label="Line height" value={captionStyleConfig.lineHeight} min={0.9} max={1.6} step={0.05} suffix="x" onChange={(lineHeight) => update({ lineHeight })} />
              <div className="grid gap-2">
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }} title="Controls how many lines subtitles can use. 1 line keeps captions on one line by shortening chunks. 2 lines is best for reels. Auto lets the app decide.">
                  Max lines
                </span>
                <div className="grid grid-cols-4 gap-1">
                  {MAX_LINE_OPTIONS.map((option) => (
                    <button
                      key={option.label}
                      className={captionStyleConfig.maxLines === option.value ? "btn-primary px-1 text-[10px]" : "btn-ghost px-1 text-[10px]"}
                      disabled={locked}
                      onClick={() => updateMaxLines(option.value)}
                      title="Controls how many lines subtitles can use."
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {maxLinesNotice && (
                  <div className="editor-notice flex items-center justify-between gap-2">
                    <span>{maxLinesNotice}</span>
                    <button
                      className="text-xs font-bold"
                      onClick={rebuildForMaxLines}
                    >
                      Rebuild
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
          <ColorInput disabled={locked} value={captionStyleConfig.textColor} onChange={(textColor) => update({ textColor })} />
        </Section>

        <Section title="Background">
          {backgroundUnavailable && <UnavailableNotice>Background is not available for this preset.</UnavailableNotice>}
          <label className="flex items-center justify-between text-[11px]" style={{ color: "var(--text-muted)" }} title="Adds a box behind subtitles to improve readability.">
            <span>Enabled</span>
            <input
              type="checkbox"
              checked={capabilities.background && captionStyleConfig.backgroundEnabled}
              disabled={locked || backgroundUnavailable}
              onChange={(event) => update({ backgroundEnabled: event.target.checked })}
            />
          </label>
          <ColorInput disabled={backgroundControlsDisabled} value={captionStyleConfig.backgroundColor} onChange={(backgroundColor) => update({ backgroundColor })} />
          <button
            className="btn-ghost w-full"
            disabled={locked || backgroundUnavailable}
            onClick={() => update({ backgroundEnabled: false, backgroundOpacity: 0 })}
          >
            Transparent / No Background
          </button>
          <div className="grid grid-cols-2 gap-2">
            {(["wrap", "fill"] as const).map((fit) => (
              <button
                key={fit}
                className={captionStyleConfig.backgroundFit === fit ? "btn-primary" : "btn-ghost"}
                disabled={backgroundControlsDisabled}
                onClick={() => update({ backgroundFit: fit })}
                title={fit === "wrap" ? "Background fits tightly around the subtitle text." : "Background stretches wider behind the subtitle block."}
              >
                {fit === "wrap" ? "Wrap" : "Fill"}
              </button>
            ))}
          </div>
          <SliderControl disabled={backgroundControlsDisabled} label="Opacity" value={captionStyleConfig.backgroundOpacity} min={0} max={1} step={0.05} suffix="" onChange={(backgroundOpacity) => update({ backgroundOpacity })} />
          <SliderControl disabled={backgroundControlsDisabled} label="Corners" value={captionStyleConfig.borderRadius} min={0} max={36} suffix="px" onChange={(borderRadius) => update({ borderRadius })} />
          <SliderControl disabled={backgroundControlsDisabled} label="Padding" value={captionStyleConfig.paddingX} min={0} max={48} suffix="px" onChange={(padding) => update({ paddingX: padding, paddingY: Math.max(0, Math.round(padding * 0.58)) })} />
        </Section>

        <Section title="Border">
          {!capabilities.backgroundBorder && <UnavailableNotice>Background border is not available for this preset.</UnavailableNotice>}
          <label className="flex items-center justify-between text-[11px]" style={{ color: "var(--text-muted)" }} title="Adds an outline around the subtitle background box.">
            <span>Background Border</span>
            <input
              type="checkbox"
              checked={capabilities.backgroundBorder && captionStyleConfig.backgroundBorderEnabled}
              disabled={backgroundBorderDisabled}
              onChange={(event) => update({ backgroundBorderEnabled: event.target.checked, backgroundBorderWidth: event.target.checked ? 2 : 0 })}
            />
          </label>
          <ColorInput disabled={backgroundBorderDisabled || !captionStyleConfig.backgroundBorderEnabled} value={captionStyleConfig.backgroundBorderColor} onChange={(backgroundBorderColor) => update({ backgroundBorderColor })} />
        </Section>

        <Section title="Text Outline">
          {!capabilities.textOutline && <UnavailableNotice>Text outline is not available for this preset.</UnavailableNotice>}
          <div className="grid grid-cols-2 gap-2">
            {OUTLINE_OPTIONS.map((option) => (
              <button
                key={option.label}
                className={outlineLabel === option.label ? "btn-primary" : "btn-ghost"}
                disabled={locked || !capabilities.textOutline}
                onClick={() => update({ textStrokeEnabled: option.width > 0, textStrokeWidth: option.width })}
                title="Adds an outline around subtitle letters to make text readable on any video."
              >
                {option.label}
              </button>
            ))}
          </div>
          <ColorInput disabled={locked || !capabilities.textOutline || !captionStyleConfig.textStrokeEnabled} value={captionStyleConfig.textStrokeColor} onChange={(textStrokeColor) => update({ textStrokeColor })} />
        </Section>

        <Section title="Shadow">
          <label className="flex items-center justify-between text-[11px]" style={{ color: "var(--text-muted)" }}>
            <span>Text Shadow</span>
            <input
              type="checkbox"
              checked={captionStyleConfig.textShadowEnabled}
              disabled={locked || !capabilities.textShadow}
              onChange={(event) => update({ textShadowEnabled: event.target.checked })}
            />
          </label>
          <ColorInput disabled={locked || !capabilities.textShadow || !captionStyleConfig.textShadowEnabled} value={captionStyleConfig.textShadowColor} onChange={(textShadowColor) => update({ textShadowColor })} />
          <SliderControl disabled={locked || !capabilities.textShadow || !captionStyleConfig.textShadowEnabled} label="Text opacity" value={captionStyleConfig.textShadowOpacity} min={0} max={1} step={0.05} suffix="" onChange={(textShadowOpacity) => update({ textShadowOpacity })} />
          <SliderControl disabled={locked || !capabilities.textShadow || !captionStyleConfig.textShadowEnabled} label="Text blur" value={captionStyleConfig.textShadowBlur} min={0} max={24} suffix="px" onChange={(textShadowBlur) => update({ textShadowBlur })} />
          <SliderControl disabled={locked || !capabilities.textShadow || !captionStyleConfig.textShadowEnabled} label="Text distance" value={captionStyleConfig.textShadowDistance} min={0} max={24} suffix="px" onChange={(textShadowDistance) => update({ textShadowDistance })} />
          <SliderControl disabled={locked || !capabilities.textShadow || !captionStyleConfig.textShadowEnabled} label="Text angle" value={captionStyleConfig.textShadowAngle} min={0} max={360} suffix="deg" onChange={(textShadowAngle) => update({ textShadowAngle })} />

          <label className="mt-1 flex items-center justify-between text-[11px]" style={{ color: "var(--text-muted)" }}>
            <span>Background Shadow</span>
            <input
              type="checkbox"
              checked={capabilities.background && captionStyleConfig.backgroundEnabled && captionStyleConfig.backgroundShadow}
              disabled={locked || backgroundUnavailable || !captionStyleConfig.backgroundEnabled}
              onChange={(event) => update({ backgroundShadow: event.target.checked })}
            />
          </label>
          {(backgroundUnavailable || !captionStyleConfig.backgroundEnabled) && (
            <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              Background shadow is visible only when this preset supports Background and Background is enabled.
            </div>
          )}
          <ColorInput disabled={backgroundControlsDisabled || !captionStyleConfig.backgroundShadow} value={captionStyleConfig.backgroundShadowColor} onChange={(backgroundShadowColor) => update({ backgroundShadowColor })} />
          <SliderControl disabled={backgroundControlsDisabled || !captionStyleConfig.backgroundShadow} label="Background opacity" value={captionStyleConfig.backgroundShadowOpacity} min={0} max={1} step={0.05} suffix="" onChange={(backgroundShadowOpacity) => update({ backgroundShadowOpacity })} />
          <SliderControl disabled={backgroundControlsDisabled || !captionStyleConfig.backgroundShadow} label="Background blur" value={captionStyleConfig.backgroundShadowBlur} min={0} max={60} suffix="px" onChange={(backgroundShadowBlur) => update({ backgroundShadowBlur })} />
          <SliderControl disabled={backgroundControlsDisabled || !captionStyleConfig.backgroundShadow} label="Background distance" value={captionStyleConfig.backgroundShadowDistance} min={0} max={36} suffix="px" onChange={(backgroundShadowDistance) => update({ backgroundShadowDistance })} />
          <SliderControl disabled={backgroundControlsDisabled || !captionStyleConfig.backgroundShadow} label="Background angle" value={captionStyleConfig.backgroundShadowAngle} min={0} max={360} suffix="deg" onChange={(backgroundShadowAngle) => update({ backgroundShadowAngle })} />
        </Section>

        {!isBuildPreset && (
          <Section title="Animations">
            <label className="grid gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
              <span>{captionStyleConfig.wordEffect === "highlight" ? "Highlight Color" : "Active Text Color"}</span>
              <ColorInput
                disabled={locked}
                value={captionStyleConfig.activeWordColor}
                onChange={(activeWordColor) => update({
                  activeWordColor,
                  ...(captionStyleConfig.wordEffect === "highlight" ? { activeWordBackgroundColor: activeWordColor } : {}),
                })}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              {ANIMATION_CARDS.map((card) => {
                const selected = captionStyleConfig.wordEffect === card.patch.wordEffect;
                return (
                  <PreviewCard
                    key={card.label}
                    label={card.label}
                    selected={selected}
                    disabled={locked}
                    activeColor={captionStyleConfig.activeWordColor}
                    mode={card.preview}
                    onClick={() => update({
                      ...card.patch,
                      ...(card.patch.wordEffect === "highlight" ? { activeWordBackgroundColor: captionStyleConfig.activeWordColor } : {}),
                    })}
                  />
                );
              })}
            </div>
          </Section>
        )}

        {isBuildPreset && (
          <>
            <Section title="Editorial Fonts">
              <label className="grid gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                <span>Big word font</span>
                <select className="control-input" value={captionStyleConfig.bigFontFamily || captionStyleConfig.fontFamily} disabled={locked} onChange={(event) => update({ bigFontFamily: event.target.value })}>
                  {CREATOR_FONTS.map((font) => <option key={font} value={font}>{font}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                <span>Small word font</span>
                <select className="control-input" value={captionStyleConfig.smallFontFamily || captionStyleConfig.fontFamily} disabled={locked} onChange={(event) => update({ smallFontFamily: event.target.value })}>
                  {CREATOR_FONTS.map((font) => <option key={font} value={font}>{font}</option>)}
                </select>
              </label>
            </Section>

            <Section title="Build Font Sizes">
              <SliderControl disabled={locked} label="Big word size" value={captionStyleConfig.bigFontSizePx || BUILD_BIG_FONT_SIZE_PX} min={80} max={400} step={1} suffix="px" onChange={(bigFontSizePx) => update({ bigFontSizePx })} />
              <SliderControl disabled={locked} label="Small word size" value={captionStyleConfig.smallFontSizePx || BUILD_SMALL_FONT_SIZE_PX} min={20} max={160} step={1} suffix="px" onChange={(smallFontSizePx) => update({ smallFontSizePx })} />
            </Section>

            <Section title="Editorial Layout">
              <label className="grid gap-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                <span>Layout</span>
                <select
                  className="control-input"
                  value={(captionStyleConfig.layoutMode || "auto") as string}
                  disabled={locked}
                  onChange={(event) => update({ layoutMode: event.target.value as CaptionStyleConfig["layoutMode"] })}
                >
                  {BUILD_LAYOUT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>

              <SliderControl disabled={locked} label="Tightness" value={captionStyleConfig.tightness || 0.75} min={0} max={10} step={0.1} onChange={(tightness) => update({ tightness })} />
              <SliderControl disabled={locked} label="Safe margin" value={captionStyleConfig.layoutSafeMarginPercent || 8} min={0} max={20} step={1} suffix="%" onChange={(layoutSafeMarginPercent) => update({ layoutSafeMarginPercent })} />
              <SliderControl disabled={locked} label="Collision padding" value={captionStyleConfig.collisionPadding || 8} min={0} max={120} step={1} suffix="px" onChange={(collisionPadding) => update({ collisionPadding })} />
            </Section>
          </>
        )}

        {capabilities.transitions && (
          <Section title="Transitions">
            <div className="grid grid-cols-2 gap-3">
              {TRANSITION_CARDS.map((card) => (
                <PreviewCard
                  key={card.label}
                  label={card.label}
                  selected={captionStyleConfig.entranceAnimation === card.value}
                  disabled={locked}
                  activeColor={captionStyleConfig.activeWordColor}
                  mode={card.preview}
                  onClick={() => update({ entranceAnimation: card.value })}
                />
              ))}
            </div>
          </Section>
        )}

        <details className="brutal-box p-3">
          <summary className="cursor-pointer text-[11px] font-bold uppercase" style={{ color: "var(--text-primary)" }}>
            Advanced
          </summary>
          <div className="mt-3 grid gap-3">
            <SliderControl disabled={locked} label="X position" value={captionStyleConfig.positionX} min={0} max={100} suffix="%" onChange={(positionX) => update({ positionX })} />
            <SliderControl disabled={locked} label="Y position" value={captionStyleConfig.positionY} min={0} max={100} suffix="%" onChange={(positionY) => update({ positionY })} />
            <SliderControl disabled={locked} label="Max width" value={captionStyleConfig.maxWidth} min={45} max={96} suffix="%" onChange={(maxWidth) => update({ maxWidth })} />
            <SliderControl disabled={locked} label="Caption scale" value={captionStyleConfig.scale} min={0} max={3} step={0.01} onChange={(scale) => update({ scale })} />
            <SliderControl disabled={locked} label="Layer opacity" value={captionStyleConfig.opacity} min={0} max={1} step={0.05} onChange={(opacity) => update({ opacity })} />
            {capabilities.asymmetricScale && (
              <>
                <label className="flex items-center justify-between text-[11px]" style={{ color: "var(--text-muted)" }}>
                  <span title="Adds slight non-uniform squash/stretch to active word motion.">Asymmetric scale</span>
                  <input
                    type="checkbox"
                    checked={Boolean(captionStyleConfig.asymmetricScaleEnabled)}
                    disabled={locked}
                    onChange={(event) => update({ asymmetricScaleEnabled: event.target.checked })}
                  />
                </label>
                <SliderControl disabled={locked || !captionStyleConfig.asymmetricScaleEnabled} label="Asymmetric strength" value={captionStyleConfig.asymmetricScaleStrength || 0} min={0} max={1} step={0.05} onChange={(asymmetricScaleStrength) => update({ asymmetricScaleStrength })} />
              </>
            )}
          </div>
        </details>

        <button className="btn-ghost w-full" disabled={locked} onClick={() => update(getCaptionStylePreset(activePresetId) || DEFAULT_WORD_HIGHLIGHT_BOX_CONFIG)}>
          Reset Defaults
        </button>
      </div>
    </div>
  );
}
