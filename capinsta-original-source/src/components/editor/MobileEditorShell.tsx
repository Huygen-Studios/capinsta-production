"use client";

import React, { useMemo, useState } from "react";
import { ChevronDown, Download, HelpCircle, Pause, Play, Redo2, Search, Undo2, X } from "lucide-react";
import MobileBottomSheet, { MobileSheetSize } from "./MobileBottomSheet";
import MobileBottomToolbar, { MobileTool } from "./MobileBottomToolbar";
import MobileCaptionsPanel from "./MobileCaptionsPanel";
import MobileTimelineView from "./MobileTimelineView";
import {
  MobileAdjustPanel,
  MobileAudioPanel,
  MobileColorsPanel,
  MobileEffectsPanel,
  MobileExportPanel,
  MobileMediaPanel,
  MobileStylePanel,
  MobileTextPanel,
  MobileVoicePanel,
} from "./MobileToolPanels";
import ProgramMonitor from "./ProgramMonitor";
import { formatTimecode } from "@/lib/captionUtils";
import { useEditorStore } from "@/store/editorStore";
import { usePlaybackStore } from "@/store/playbackStore";
import { useProjectHistoryStore } from "@/store/projectHistoryStore";

function sheetTitle(tool: MobileTool) {
  if (tool === "audio") return "Audio";
  if (tool === "text") return "Text";
  if (tool === "voice") return "Voice";
  if (tool === "media") return "Media";
  if (tool === "captions") return "Captions";
  if (tool === "style") return "Style";
  if (tool === "effects") return "Effects";
  if (tool === "colors") return "Colors";
  if (tool === "adjust") return "Adjust";
  return "Export";
}

function sheetSize(tool: MobileTool): MobileSheetSize {
  if (tool === "captions") return "medium";
  if (tool === "style" || tool === "effects" || tool === "colors") return "expanded";
  return "medium";
}

function ToolSheetContent({ tool }: { tool: MobileTool }) {
  if (tool === "captions") return <MobileCaptionsPanel />;
  if (tool === "style") return <MobileStylePanel />;
  if (tool === "effects") return <MobileEffectsPanel />;
  if (tool === "colors") return <MobileColorsPanel />;
  if (tool === "export") return <MobileExportPanel />;
  if (tool === "media") return <MobileMediaPanel />;
  if (tool === "audio") return <MobileAudioPanel />;
  if (tool === "text") return <MobileTextPanel />;
  if (tool === "voice") return <MobileVoicePanel />;
  return <MobileAdjustPanel />;
}

export default function MobileEditorShell() {
  const [activeTool, setActiveTool] = useState<MobileTool | null>(null);
  const setShowExportModal = useEditorStore((s) => s.setShowExportModal);
  const mediaFiles = useEditorStore((s) => s.mediaFiles);
  const sequenceSettings = useEditorStore((s) => s.sequenceSettings);
  const { isPlaying, currentTime, duration, togglePlayPause } = usePlaybackStore();
  const { undo, redo, canUndo, canRedo } = useProjectHistoryStore();
  const projectName = useMemo(() => mediaFiles[0]?.name?.replace(/\.[^.]+$/, "") || "New project", [mediaFiles]);

  const openTool = (tool: MobileTool) => {
    if (tool === "export") {
      setActiveTool(tool);
      return;
    }
    setActiveTool((current) => (current === tool ? null : tool));
  };

  return (
    <main className="mobile-editor-shell">
      <header className="mobile-editor-topbar">
        <button className="mobile-icon-action" title="Close">
          <X size={20} />
        </button>
        <button className="mobile-project-title" title={projectName}>
          <span>{projectName}</span>
          <ChevronDown size={15} />
        </button>
        <div className="mobile-topbar-spacer" />
        <button className="mobile-icon-action" title="Search">
          <Search size={18} />
        </button>
        <button className="mobile-quality-chip" title="Sequence">
          {sequenceSettings.aspectRatio || "HD"}
        </button>
        <button className="btn-primary mobile-next-button" onClick={() => setShowExportModal(true)}>
          Export
          <Download size={15} />
        </button>
      </header>

      <section className="mobile-preview-stage">
        <ProgramMonitor chrome="preview-only" />
      </section>

      <section className="mobile-playback-row">
        <button className="mobile-play-button" onClick={togglePlayPause} title="Play/Pause">
          {isPlaying ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <div className="mobile-time-stack">
          <span>{formatTimecode(currentTime)}</span>
          <span>{formatTimecode(duration)}</span>
        </div>
        <button className="mobile-icon-action" disabled={!canUndo} onClick={undo} title="Undo">
          <Undo2 size={18} />
        </button>
        <button className="mobile-icon-action" disabled={!canRedo} onClick={redo} title="Redo">
          <Redo2 size={18} />
        </button>
        <button className="mobile-icon-action" title="Help">
          <HelpCircle size={18} />
        </button>
      </section>

      <MobileTimelineView />
      <MobileBottomToolbar activeTool={activeTool} onSelect={openTool} />

      {activeTool && (
        <MobileBottomSheet title={sheetTitle(activeTool)} size={sheetSize(activeTool)} onClose={() => setActiveTool(null)}>
          <ToolSheetContent tool={activeTool} />
        </MobileBottomSheet>
      )}
    </main>
  );
}
