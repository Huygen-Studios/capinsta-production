"use client";

import React from "react";
import { Download } from "lucide-react";
import { FRAME_RATE_PRESETS, SEQUENCE_RESOLUTION_PRESETS, resolveExportDimensions, resolveExportFps } from "@/lib/editorModel";
import { ExportAspectRatio, ExportDurationSource, ExportFrameRate, ExportQualityPreset, ExportResolutionPreset } from "@/lib/types";
import { useEditorStore } from "@/store/editorStore";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-[10px] uppercase" style={{ color: "var(--text-muted)" }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export default function ExportSettingsPanel() {
  const { exportSettings, setExportSettings, sequenceSettings, setShowExportModal } = useEditorStore();
  const exportDimensions = resolveExportDimensions(exportSettings, sequenceSettings);
  const exportFps = resolveExportFps(exportSettings, sequenceSettings);
  const isCustomResolution = exportSettings.resolutionPreset === "custom";
  const isCaptionsOnly = exportSettings.mode === "captions_only";

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        <div className="brutal-box grid gap-2 p-3 text-[10px]" style={{ color: "var(--text-muted)" }}>
          <div className="font-semibold uppercase">Resolved Output</div>
          <div className="flex justify-between font-mono">
            <span>{exportDimensions.width}x{exportDimensions.height}</span>
            <span>{exportFps}fps</span>
          </div>
        </div>

        <div className="grid gap-2">
          <Field label="Export mode">
            <select
              className="control-input"
              value={exportSettings.mode}
              onChange={(event) => {
                const mode = event.target.value as typeof exportSettings.mode;
                setExportSettings({ mode, includeAudio: mode === "captions_only" ? false : exportSettings.includeAudio });
              }}
            >
              <option value="full_video">Full video with visible tracks</option>
              <option value="captions_only">Captions-only on solid background</option>
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Resolution">
              <select className="control-input" value={exportSettings.resolutionPreset} onChange={(event) => setExportSettings({ resolutionPreset: event.target.value as ExportResolutionPreset })}>
                <option value="sequence">Same as sequence</option>
                {Object.entries(SEQUENCE_RESOLUTION_PRESETS).map(([id, preset]) => (
                  <option key={id} value={id}>
                    {preset.label}
                  </option>
                ))}
                <option value="custom">Custom</option>
              </select>
            </Field>
            <Field label="Aspect">
              <select className="control-input" value={exportSettings.aspectRatio} onChange={(event) => setExportSettings({ aspectRatio: event.target.value as ExportAspectRatio })}>
                <option value="sequence">Same as sequence</option>
                <option value="9:16">9:16</option>
                <option value="16:9">16:9</option>
                <option value="1:1">1:1</option>
                <option value="4:5">4:5</option>
                <option value="custom">Custom</option>
              </select>
            </Field>
          </div>

          {isCustomResolution && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Width">
                <input className="control-input" type="number" min={16} value={exportSettings.width} onChange={(event) => setExportSettings({ width: Number(event.target.value) })} />
              </Field>
              <Field label="Height">
                <input className="control-input" type="number" min={16} value={exportSettings.height} onChange={(event) => setExportSettings({ height: Number(event.target.value) })} />
              </Field>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Field label="Frame rate">
              <select className="control-input" value={exportSettings.fps} onChange={(event) => {
                const value = event.target.value;
                setExportSettings({ fps: value === "sequence" ? "sequence" : Number(value) as ExportFrameRate });
              }}>
                <option value="sequence">Same as sequence</option>
                {FRAME_RATE_PRESETS.map((fps) => (
                  <option key={fps} value={fps}>
                    {fps} fps
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Quality">
              <select className="control-input" value={exportSettings.quality} onChange={(event) => setExportSettings({ quality: event.target.value as ExportQualityPreset })}>
                <option value="best">Best Quality</option>
                <option value="high">High</option>
                <option value="balanced">Balanced</option>
                <option value="low_bitrate">Low Bitrate</option>
                <option value="custom">Custom</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Bitrate">
              <select className="control-input" value={exportSettings.bitrate} onChange={(event) => setExportSettings({ bitrate: event.target.value as typeof exportSettings.bitrate })}>
                <option value="auto">Auto</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="custom">Custom Mbps</option>
              </select>
            </Field>
            <Field label="Custom Mbps">
              <input
                className="control-input"
                type="number"
                min={0.5}
                step={0.5}
                disabled={exportSettings.bitrate !== "custom" && exportSettings.quality !== "custom"}
                value={exportSettings.customBitrateMbps}
                onChange={(event) => setExportSettings({ customBitrateMbps: Number(event.target.value) })}
              />
            </Field>
          </div>

          {isCaptionsOnly && (
            <>
              <Field label="Solid background">
                <input className="control-input h-9" type="color" value={exportSettings.backgroundColor} onChange={(event) => setExportSettings({ backgroundColor: event.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Duration source">
                  <select className="control-input" value={exportSettings.durationSource} onChange={(event) => setExportSettings({ durationSource: event.target.value as ExportDurationSource })}>
                    <option value="caption">Match captions</option>
                    <option value="timeline">Match timeline</option>
                    <option value="sequence">Match sequence</option>
                    <option value="custom">Custom duration</option>
                  </select>
                </Field>
                <Field label="Duration seconds">
                  <input className="control-input" type="number" min={0.1} step={0.1} value={exportSettings.customDuration} disabled={exportSettings.durationSource !== "custom"} onChange={(event) => setExportSettings({ customDuration: Number(event.target.value) })} />
                </Field>
              </div>
            </>
          )}

          <div className="grid gap-2 brutal-box p-3">
            <label className="flex items-center justify-between text-[10px]" style={{ color: "var(--text-muted)" }}>
              <span>Include audio</span>
              <input type="checkbox" checked={exportSettings.includeAudio} onChange={(event) => setExportSettings({ includeAudio: event.target.checked })} />
            </label>
            <label className="flex items-center justify-between text-[10px]" style={{ color: "var(--text-muted)" }}>
              <span>Export visible tracks only</span>
              <input type="checkbox" checked={exportSettings.visibleTracksOnly} onChange={(event) => setExportSettings({ visibleTracksOnly: event.target.checked })} />
            </label>
            <label className="flex items-center justify-between text-[10px]" style={{ color: "var(--text-muted)" }}>
              <span>Burn captions</span>
              <input type="checkbox" checked={exportSettings.burnCaptions} onChange={(event) => setExportSettings({ burnCaptions: event.target.checked })} />
            </label>
            <label className="flex items-center justify-between text-[10px]" style={{ color: "var(--text-muted)" }}>
              <span>Hardware acceleration</span>
              <input type="checkbox" checked={exportSettings.hardwareAcceleration} onChange={(event) => setExportSettings({ hardwareAcceleration: event.target.checked })} />
            </label>
          </div>
        </div>
      </div>
      <div className="border-t p-2" style={{ borderColor: "var(--border)" }}>
        <button className="btn-primary flex w-full items-center justify-center gap-2" onClick={() => setShowExportModal(true)}>
          <Download size={14} /> Open Export
        </button>
      </div>
    </div>
  );
}
