"use client";

import React, { useState } from "react";
import { ChevronLeft, ChevronRight, Languages, ListVideo, Palette, SlidersHorizontal, Sparkles, Type, Wand2 } from "lucide-react";
import CaptionEditorPanel from "./CaptionEditorPanel";
import CaptionStylePanel from "./CaptionStylePanel";
import EffectControlsPanel from "./EffectControlsPanel";
import { useCaptionStore } from "@/store/captionStore";
import { useEditorStore } from "@/store/editorStore";

type CaptionsView = "menu" | "generate" | "styles" | "transcription" | "position" | "effects" | "colors" | "advanced";

function MobileSheetRow({
  icon,
  label,
  value,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  onClick?: () => void;
}) {
  return (
    <button className="mobile-sheet-row" onClick={onClick}>
      <span className="mobile-sheet-row-icon">{icon}</span>
      <span className="mobile-sheet-row-label">{label}</span>
      {value && <span className="mobile-sheet-row-value">{value}</span>}
      {onClick && <ChevronRight size={18} />}
    </button>
  );
}

function BackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <button className="mobile-sheet-back" onClick={onBack}>
      <ChevronLeft size={18} />
      <span>{title}</span>
    </button>
  );
}

export default function MobileCaptionsPanel() {
  const [view, setView] = useState<CaptionsView>("menu");
  const captions = useCaptionStore((s) => s.captions);
  const language = useEditorStore((s) => s.language);

  if (view === "generate") {
    return (
      <div className="mobile-sheet-deep-panel">
        <BackHeader title="Generate captions" onBack={() => setView("menu")} />
        <CaptionEditorPanel initialFlow="setup" />
      </div>
    );
  }

  if (view === "styles" || view === "colors" || view === "advanced") {
    return (
      <div className="mobile-sheet-deep-panel">
        <BackHeader title={view === "styles" ? "Styles" : view === "colors" ? "Colors" : "Advanced"} onBack={() => setView("menu")} />
        <CaptionStylePanel />
      </div>
    );
  }

  if (view === "effects" || view === "position") {
    return (
      <div className="mobile-sheet-deep-panel">
        <BackHeader title={view === "effects" ? "Caption effects" : "Caption positioning"} onBack={() => setView("menu")} />
        <EffectControlsPanel />
      </div>
    );
  }

  if (view === "transcription") {
    return (
      <div className="mobile-sheet-deep-panel">
        <BackHeader title="Transcription controls" onBack={() => setView("menu")} />
        <CaptionEditorPanel initialFlow="setup" />
      </div>
    );
  }

  return (
    <>
      <div className="mobile-sheet-list">
        <MobileSheetRow icon={<Wand2 size={19} />} label="Generate from" value="Video" onClick={() => setView("generate")} />
        <MobileSheetRow icon={<Languages size={19} />} label="Spoken language" value={language === "auto_mixed_indian" ? "Auto-detect" : language} onClick={() => setView("generate")} />
        <MobileSheetRow icon={<Palette size={19} />} label="Styles" onClick={() => setView("styles")} />
        <MobileSheetRow icon={<ListVideo size={19} />} label="Transcription controls" onClick={() => setView("transcription")} />
        <MobileSheetRow icon={<Type size={19} />} label="Caption positioning" onClick={() => setView("position")} />
        <MobileSheetRow icon={<Sparkles size={19} />} label="Caption effects" onClick={() => setView("effects")} />
        <MobileSheetRow icon={<Palette size={19} />} label="Caption colors" onClick={() => setView("colors")} />
        <MobileSheetRow icon={<SlidersHorizontal size={19} />} label="Advanced" onClick={() => setView("advanced")} />
      </div>
      <button className="mobile-sheet-primary" onClick={() => setView("generate")}>
        {captions.length ? "Edit captions" : "Generate captions"}
      </button>
      {captions.length > 0 && (
        <button className="mobile-sheet-secondary" onClick={() => setView("generate")}>
          Regenerate captions
        </button>
      )}
    </>
  );
}
