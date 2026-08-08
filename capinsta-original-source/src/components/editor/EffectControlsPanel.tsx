"use client";

import React, { useCallback, useMemo } from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { CAPTION_PRESET_LIST, getCaptionPreset } from "@/lib/captionStylePresets";
import { applyEditedCaptionText } from "@/lib/captionUtils";
import {
  DEFAULT_CLIP_TRANSFORM,
  findClipWithTrack,
  isCaptionLocked,
  normalizeClipTransform,
} from "@/lib/editorModel";
import { CaptionStylePresetId, ClipTransform, TimelineClip } from "@/lib/types";
import { useCaptionStore } from "@/store/captionStore";
import { useEditorStore } from "@/store/editorStore";
import { useTimelineStore } from "@/store/timelineStore";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded border p-2" style={{ borderColor: "var(--border)", background: "var(--bg-panel-raised)" }}>
      <div className="text-[10px] font-semibold uppercase" style={{ color: "var(--text-muted)" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function NumberControl({
  label,
  value,
  min,
  max,
  step = 0.1,
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid grid-cols-[1fr_86px] items-center gap-2 text-[10px]" style={{ color: "var(--text-muted)" }}>
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : 0}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="rounded border-0 px-2 py-1 text-xs outline-none disabled:opacity-50"
        style={{ background: "var(--bg-control)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
      />
    </label>
  );
}

function SliderControl({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  disabled = false,
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
      <div className="flex items-center justify-between text-[10px]" style={{ color: "var(--text-muted)" }}>
        <span>{label}</span>
        <span>
          {Number(value).toFixed(step < 1 ? 2 : 0)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-[var(--accent)] disabled:opacity-50"
      />
    </label>
  );
}

function ToggleControl({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-[10px]" style={{ color: "var(--text-muted)" }}>
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5 accent-[var(--accent)] disabled:opacity-50"
      />
    </label>
  );
}

function kindLabel(kind: TimelineClip["type"]) {
  if (kind === "video") return "Video Clip";
  if (kind === "image") return "Image Clip";
  if (kind === "audio") return "Audio Clip";
  if (kind === "overlay") return "Overlay Clip";
  return "Caption Clip";
}

export default function EffectControlsPanel() {
  const tracks = useTimelineStore((s) => s.tracks);
  const selectedClipIds = useTimelineStore((s) => s.selectedClipIds);
  const updateClip = useTimelineStore((s) => s.updateClip);
  const { mediaFiles, sequenceSettings, setShowSequenceSettings, captionLayerTransform, setCaptionLayerTransform, theme, applyCaptionStylePreset, setRightPanelTab } =
    useEditorStore();
  const captions = useCaptionStore((s) => s.captions);
  const selectedCaptionIds = useCaptionStore((s) => s.selectedIds);
  const updateCaption = useCaptionStore((s) => s.updateCaption);
  const setThemeForAll = useCaptionStore((s) => s.setThemeForAll);

  const selectedClip = useMemo(() => findClipWithTrack(tracks, selectedClipIds[0]), [selectedClipIds, tracks]);
  const selectedCaption = useMemo(
    () => captions.find((caption) => selectedCaptionIds.has(caption.id)) || null,
    [captions, selectedCaptionIds]
  );

  const applyPreset = useCallback(
    (presetId: CaptionStylePresetId) => {
      applyCaptionStylePreset(presetId);
      setThemeForAll(presetId);
      setRightPanelTab("caption-style");
    },
    [applyCaptionStylePreset, setRightPanelTab, setThemeForAll]
  );

  if (selectedClip) {
    const { clip, track } = selectedClip;
    const media = mediaFiles.find((file) => file.id === clip.mediaId);
    const locked = track.locked;
    const transform = normalizeClipTransform(clip.transform);
    const duration = Math.max(0.1, clip.end - clip.start);

    const updateTransform = (patch: Partial<ClipTransform>) => {
      if (locked) return;
      updateClip(clip.id, { transform: { ...transform, ...patch } });
    };

    const updateTiming = (patch: Partial<Pick<TimelineClip, "start" | "end" | "trimStart" | "trimEnd">>) => {
      if (locked) return;
      const nextStart = Math.max(0, patch.start ?? clip.start);
      const nextEnd = Math.max(nextStart + 0.1, patch.end ?? clip.end);
      updateClip(clip.id, {
        ...patch,
        start: nextStart,
        end: nextEnd,
      });
    };

    return (
      <div className="flex h-full flex-col">
        <div className="flex-1 space-y-2 overflow-y-auto p-2">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={14} style={{ color: "var(--accent)" }} />
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                {media?.name || kindLabel(clip.type)}
              </div>
              <div className="text-[10px]" style={{ color: locked ? "#ffd36b" : "var(--text-muted)" }}>
                {track.label} · {kindLabel(clip.type)} · {locked ? "locked" : "editable"}
              </div>
            </div>
          </div>

          {clip.type !== "audio" && (
            <Section title="Transform">
              <SliderControl label="Position X" value={transform.xPercent} min={0} max={100} suffix="%" disabled={locked} onChange={(xPercent) => updateTransform({ xPercent })} />
              <SliderControl label="Position Y" value={transform.yPercent} min={0} max={100} suffix="%" disabled={locked} onChange={(yPercent) => updateTransform({ yPercent })} />
              <SliderControl label="Scale" value={transform.scale} min={0.1} max={4} step={0.05} disabled={locked} onChange={(scale) => updateTransform({ scale })} />
              <SliderControl label="Rotation" value={transform.rotation} min={-180} max={180} disabled={locked} onChange={(rotation) => updateTransform({ rotation })} />
              <SliderControl label="Opacity" value={transform.opacity} min={0} max={1} step={0.01} disabled={locked} onChange={(opacity) => updateTransform({ opacity })} />
              <div className="grid grid-cols-2 gap-2">
                <ToggleControl label="Visible" checked={clip.visible !== false} disabled={locked} onChange={(visible) => updateClip(clip.id, { visible })} />
                <button className="btn-ghost flex items-center justify-center gap-1" disabled={locked} onClick={() => updateClip(clip.id, { transform: DEFAULT_CLIP_TRANSFORM })}>
                  <RotateCcw size={12} /> Reset
                </button>
              </div>
            </Section>
          )}

          {clip.type === "audio" && (
            <Section title="Audio">
              <SliderControl label="Volume" value={clip.volume ?? 1} min={0} max={2} step={0.01} disabled={locked} onChange={(volume) => updateClip(clip.id, { volume })} />
              <ToggleControl label="Mute" checked={Boolean(clip.muted)} disabled={locked} onChange={(muted) => updateClip(clip.id, { muted })} />
            </Section>
          )}

          <Section title="Timing">
            <NumberControl label="Start time" min={0} value={clip.start} disabled={locked} onChange={(start) => updateTiming({ start })} />
            <NumberControl label="End time" min={clip.start + 0.1} value={clip.end} disabled={locked} onChange={(end) => updateTiming({ end })} />
            <NumberControl label="Duration" min={0.1} value={duration} disabled={locked} onChange={(nextDuration) => updateTiming({ end: clip.start + Math.max(0.1, nextDuration) })} />
            <div className="grid grid-cols-2 gap-2">
              <NumberControl label="Trim start" min={0} value={clip.trimStart ?? 0} disabled={locked} onChange={(trimStart) => updateTiming({ trimStart })} />
              <NumberControl label="Trim end" min={0} value={clip.trimEnd ?? 0} disabled={locked} onChange={(trimEnd) => updateTiming({ trimEnd })} />
            </div>
          </Section>
        </div>
      </div>
    );
  }

  if (selectedCaption) {
    const locked = isCaptionLocked(selectedCaption, tracks);

    return (
      <div className="flex h-full flex-col">
        <div className="flex-1 space-y-2 overflow-y-auto p-2">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={14} style={{ color: "var(--accent)" }} />
            <div>
              <div className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>
                Caption Layer
              </div>
              <div className="text-[10px]" style={{ color: locked ? "#ffd36b" : "var(--text-muted)" }}>
                {locked ? "Track locked" : "Global caption transform"}
              </div>
            </div>
          </div>

          <Section title="Caption Transform">
            <SliderControl label="Position X" value={captionLayerTransform.xPercent} min={0} max={100} suffix="%" disabled={locked} onChange={(xPercent) => setCaptionLayerTransform({ xPercent })} />
            <SliderControl label="Position Y" value={captionLayerTransform.yPercent} min={0} max={100} suffix="%" disabled={locked} onChange={(yPercent) => setCaptionLayerTransform({ yPercent })} />
            <SliderControl label="Scale" value={captionLayerTransform.scale} min={0.25} max={3} step={0.05} disabled={locked} onChange={(scale) => setCaptionLayerTransform({ scale })} />
            <SliderControl label="Rotation" value={captionLayerTransform.rotation} min={-180} max={180} disabled={locked} onChange={(rotation) => setCaptionLayerTransform({ rotation })} />
            <SliderControl label="Opacity" value={captionLayerTransform.opacity} min={0} max={1} step={0.01} disabled={locked} onChange={(opacity) => setCaptionLayerTransform({ opacity })} />
          </Section>

          <Section title="Caption Style">
            <div className="grid grid-cols-2 gap-2">
              {CAPTION_PRESET_LIST.map((preset) => (
                <button
                  key={preset.id}
                  className={theme === preset.id ? "btn-primary" : "btn-ghost"}
                  disabled={locked}
                  onClick={() => applyPreset(preset.id)}
                  title={getCaptionPreset(preset.id).description}
                >
                  {preset.name.replace(" Style", "")}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Caption Text">
            <textarea
              key={selectedCaption.id}
              className="min-h-20 w-full resize-none rounded border-0 px-2 py-1 text-xs outline-none disabled:opacity-50"
              style={{ background: "var(--bg-control)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
              defaultValue={selectedCaption.text}
              disabled={locked}
              onBlur={(event) => updateCaption(selectedCaption.id, applyEditedCaptionText(selectedCaption, event.target.value))}
            />
          </Section>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        <div className="rounded border p-3 text-xs" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
          Select a clip to edit its controls.
        </div>
        <Section title="Sequence">
          <div className="grid grid-cols-2 gap-2 text-[10px]" style={{ color: "var(--text-muted)" }}>
            <span>Size</span>
            <span className="text-right font-mono" style={{ color: "var(--text-primary)" }}>
              {sequenceSettings.width}x{sequenceSettings.height}
            </span>
            <span>FPS</span>
            <span className="text-right font-mono" style={{ color: "var(--text-primary)" }}>
              {sequenceSettings.fps}
            </span>
            <span>Aspect</span>
            <span className="text-right font-mono" style={{ color: "var(--text-primary)" }}>
              {sequenceSettings.aspectRatio}
            </span>
          </div>
          <button className="btn-primary w-full" onClick={() => setShowSequenceSettings(true)}>
            Open Sequence Settings
          </button>
        </Section>
      </div>
    </div>
  );
}
