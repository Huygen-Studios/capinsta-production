"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Check, MonitorCog, X } from "lucide-react";
import {
  ASPECT_RATIO_PRESETS,
  FRAME_RATE_PRESETS,
  SEQUENCE_RESOLUTION_PRESETS,
  inferAspectRatio,
  inferResolutionPreset,
  normalizeSequenceSettings,
} from "@/lib/editorModel";
import { SequenceAspectRatio, SequenceResolutionPreset, SequenceSettings, VideoFrameRate } from "@/lib/types";
import { useEditorStore } from "@/store/editorStore";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-[10px] uppercase" style={{ color: "var(--text-muted)" }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function Select<T extends string | number>({
  value,
  onChange,
  children,
}: {
  value: T;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      className="control-input"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {children}
    </select>
  );
}

export default function SequenceSettingsModal() {
  const show = useEditorStore((s) => s.showSequenceSettings);
  const setShow = useEditorStore((s) => s.setShowSequenceSettings);
  const sequenceSettings = useEditorStore((s) => s.sequenceSettings);
  const setSequenceSettings = useEditorStore((s) => s.setSequenceSettings);
  const [draft, setDraft] = useState<SequenceSettings>(() => normalizeSequenceSettings(sequenceSettings));
  const [error, setError] = useState("");

  useEffect(() => {
    if (show) {
      setDraft(normalizeSequenceSettings(sequenceSettings));
      setError("");
    }
  }, [sequenceSettings, show]);

  const previewAspect = useMemo(() => `${draft.width} / ${draft.height}`, [draft.height, draft.width]);

  if (!show) return null;

  const updateDraft = (patch: Partial<SequenceSettings>) => {
    setDraft((current) => normalizeSequenceSettings({ ...current, ...patch }));
  };

  const changeAspect = (aspectRatio: SequenceAspectRatio) => {
    if (aspectRatio === "custom") {
      updateDraft({ aspectRatio, resolutionPreset: "custom" });
      return;
    }
    updateDraft({ aspectRatio, ...ASPECT_RATIO_PRESETS[aspectRatio] });
  };

  const changeResolution = (resolutionPreset: SequenceResolutionPreset) => {
    if (resolutionPreset === "custom") {
      updateDraft({ resolutionPreset, aspectRatio: "custom" });
      return;
    }
    const preset = SEQUENCE_RESOLUTION_PRESETS[resolutionPreset];
    updateDraft({
      resolutionPreset,
      width: preset.width,
      height: preset.height,
      aspectRatio: preset.aspectRatio,
    });
  };

  const save = () => {
    const normalized = normalizeSequenceSettings({
      ...draft,
      width: Math.round(Number(draft.width)),
      height: Math.round(Number(draft.height)),
      aspectRatio: draft.aspectRatio === "custom" ? inferAspectRatio(draft.width, draft.height) : draft.aspectRatio,
      resolutionPreset: draft.resolutionPreset === "custom" ? inferResolutionPreset(draft.width, draft.height) : draft.resolutionPreset,
    });
    if (normalized.width < 16 || normalized.height < 16) {
      setError("Resolution must be at least 16 x 16.");
      return;
    }
    setSequenceSettings(normalized);
    setShow(false);
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={() => setShow(false)} />
      <div className="modal-shell relative w-[min(720px,calc(100vw-32px))] overflow-hidden">
        <div className="panel-header justify-between">
          <div className="flex items-center gap-2">
            <MonitorCog size={15} style={{ color: "var(--accent)" }} />
            <span>Sequence Settings</span>
          </div>
          <button className="icon-button" onClick={() => setShow(false)} title="Cancel">
            <X size={15} />
          </button>
        </div>

        <div className="grid gap-4 p-4 md:grid-cols-[1fr_220px]">
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Aspect ratio">
                <Select value={draft.aspectRatio} onChange={(value) => changeAspect(value as SequenceAspectRatio)}>
                  <option value="9:16">9:16 vertical</option>
                  <option value="16:9">16:9 wide</option>
                  <option value="1:1">1:1 square</option>
                  <option value="4:5">4:5 social</option>
                  <option value="custom">Custom</option>
                </Select>
              </Field>
              <Field label="Resolution preset">
                <Select value={draft.resolutionPreset} onChange={(value) => changeResolution(value as SequenceResolutionPreset)}>
                  {Object.entries(SEQUENCE_RESOLUTION_PRESETS).map(([id, preset]) => (
                    <option key={id} value={id}>
                      {preset.label}
                    </option>
                  ))}
                  <option value="custom">Custom</option>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Width">
                <input
                  className="control-input"
                  type="number"
                  min={16}
                  step={2}
                  value={draft.width}
                  onChange={(event) => updateDraft({ width: Number(event.target.value), resolutionPreset: "custom", aspectRatio: "custom" })}
                />
              </Field>
              <Field label="Height">
                <input
                  className="control-input"
                  type="number"
                  min={16}
                  step={2}
                  value={draft.height}
                  onChange={(event) => updateDraft({ height: Number(event.target.value), resolutionPreset: "custom", aspectRatio: "custom" })}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Frame rate">
                <Select value={draft.fps} onChange={(value) => updateDraft({ fps: Number(value) as VideoFrameRate })}>
                  {FRAME_RATE_PRESETS.map((fps) => (
                    <option key={fps} value={fps}>
                      {fps} fps
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Background color">
                <input
                  className="control-input h-9"
                  type="color"
                  value={draft.backgroundColor}
                  onChange={(event) => updateDraft({ backgroundColor: event.target.value })}
                />
              </Field>
            </div>

            <div className="brutal-box grid gap-2 p-3">
              <label className="flex items-center justify-between gap-3 text-xs" style={{ color: "var(--text-primary)" }}>
                <span>Safe margins</span>
                <input
                  type="checkbox"
                  checked={draft.safeMarginsEnabled}
                  onChange={(event) => updateDraft({ safeMarginsEnabled: event.target.checked })}
                />
              </label>
              <label className="grid gap-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
                <span>{draft.safeMarginsPercent}% margin</span>
                <input
                  type="range"
                  min={0}
                  max={25}
                  value={draft.safeMarginsPercent}
                  onChange={(event) => updateDraft({ safeMarginsPercent: Number(event.target.value), safeMargins: Number(event.target.value) })}
                  disabled={!draft.safeMarginsEnabled}
                />
              </label>
            </div>

            {error && <div className="editor-notice error">{error}</div>}
          </div>

          <div className="grid content-start gap-2">
            <div className="text-[10px] font-semibold uppercase" style={{ color: "var(--text-muted)" }}>
              Preview
            </div>
            <div className="grid h-72 place-items-center brutal-box p-3">
              <div
                className="max-h-full max-w-full border-2"
                style={{
                  aspectRatio: previewAspect,
                  width: "100%",
                  background: draft.backgroundColor,
                  borderColor: "var(--border-strong)",
                }}
              />
            </div>
            <div className="font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
              {draft.width}x{draft.height} / {draft.fps}fps
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t p-3" style={{ borderColor: "var(--border)" }}>
          <button className="btn-ghost" onClick={() => setShow(false)}>
            Cancel
          </button>
          <button className="btn-primary flex items-center gap-2" onClick={save}>
            <Check size={14} /> Save Sequence
          </button>
        </div>
      </div>
    </div>
  );
}
