"use client";

import React from "react";
import { Captions, Film, Music, SlidersHorizontal, Type } from "lucide-react";
import CaptionStylePanel from "./CaptionStylePanel";
import EffectControlsPanel from "./EffectControlsPanel";
import ExportSettingsPanel from "./ExportSettingsPanel";
import MediaPanel from "./MediaPanel";
import { openMediaPicker } from "@/lib/mediaImport";
import { useEditorStore } from "@/store/editorStore";

function PlaceholderToolPanel({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="mobile-placeholder-panel">
      <div className="mobile-placeholder-icon">
        <SlidersHorizontal size={22} />
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function MobileStylePanel() {
  return <CaptionStylePanel />;
}

export function MobileEffectsPanel() {
  return <EffectControlsPanel />;
}

export function MobileColorsPanel() {
  return <CaptionStylePanel />;
}

export function MobileExportPanel() {
  const setShowExportModal = useEditorStore((s) => s.setShowExportModal);
  return (
    <div className="mobile-sheet-deep-panel">
      <ExportSettingsPanel />
      <button className="mobile-sheet-primary" onClick={() => setShowExportModal(true)}>
        Export Project
      </button>
    </div>
  );
}

export function MobileMediaPanel() {
  return (
    <div className="mobile-sheet-deep-panel">
      <MediaPanel />
      <button className="mobile-sheet-primary" onClick={() => void openMediaPicker()}>
        Import media
      </button>
    </div>
  );
}

export function MobileTextPanel() {
  return <PlaceholderToolPanel title="Text" body="Use Captions to generate or edit subtitle text. Free text layers can be added from the desktop editor." action={<Captions size={20} />} />;
}

export function MobileAudioPanel() {
  return <PlaceholderToolPanel title="Audio" body="Imported video audio stays linked to the timeline. Detailed audio layer editing remains available on desktop." action={<Music size={20} />} />;
}

export function MobileVoicePanel() {
  return <PlaceholderToolPanel title="Voice" body="Voice tools are not enabled for this project yet. Caption generation still uses the existing speech-to-text flow." action={<Type size={20} />} />;
}

export function MobileAdjustPanel() {
  return <PlaceholderToolPanel title="Adjust" body="Select a clip or caption, then use Effects for transform and timing controls." action={<Film size={20} />} />;
}
