"use client";

import React from "react";
import { FileSliders, MessageSquareText, Palette, Settings2 } from "lucide-react";
import { RightPanelTab } from "@/lib/types";
import { useEditorStore } from "@/store/editorStore";
import CaptionEditorPanel from "./CaptionEditorPanel";
import CaptionStylePanel from "./CaptionStylePanel";
import EffectControlsPanel from "./EffectControlsPanel";
import ExportSettingsPanel from "./ExportSettingsPanel";

const TABS: { id: RightPanelTab; label: string; icon: React.ReactNode }[] = [
  { id: "effect-controls", label: "Effect Controls", icon: <FileSliders size={13} /> },
  { id: "caption-editor", label: "Caption Editor", icon: <MessageSquareText size={13} /> },
  { id: "caption-style", label: "Caption Style", icon: <Palette size={13} /> },
  { id: "export-settings", label: "Export", icon: <Settings2 size={13} /> },
];

export default function RightPanel() {
  const rightPanelTab = useEditorStore((s) => s.rightPanelTab);
  const setRightPanelTab = useEditorStore((s) => s.setRightPanelTab);

  return (
    <div className="panel flex h-full flex-col">
      <div className="panel-header gap-1 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`panel-header-tab flex shrink-0 items-center gap-1 ${rightPanelTab === tab.id ? "active" : ""}`}
            onClick={() => setRightPanelTab(tab.id)}
            title={tab.label}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {rightPanelTab === "effect-controls" && <EffectControlsPanel />}
        {rightPanelTab === "caption-editor" && <CaptionEditorPanel />}
        {rightPanelTab === "caption-style" && <CaptionStylePanel />}
        {rightPanelTab === "export-settings" && <ExportSettingsPanel />}
      </div>
    </div>
  );
}
