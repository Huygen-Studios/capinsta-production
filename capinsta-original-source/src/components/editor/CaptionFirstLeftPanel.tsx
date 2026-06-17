"use client";

import React from "react";
import {
  Layers,
  Mic2,
  Palette,
  Plus,
  Subtitles,
  UploadCloud,
} from "lucide-react";
import CaptionEditorPanel from "./CaptionEditorPanel";
import MediaPanel from "./MediaPanel";
import { useEditorStore } from "@/store/editorStore";
import { LeftSidebarTab } from "@/lib/types";

type LeftTool = LeftSidebarTab | "export";

const TOOLS: { id: LeftTool; label: string; icon: React.ReactNode }[] = [
  { id: "media", label: "Media", icon: <UploadCloud size={18} /> },
  { id: "subtitles", label: "Subs", icon: <Subtitles size={18} /> },
  { id: "templates", label: "Styles", icon: <Palette size={18} /> },
  { id: "export", label: "Export", icon: <Layers size={18} /> },
];

function PlaceholderPanel({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <div className="panel-header justify-center">{title}</div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-5 text-center">
        <Mic2 size={28} style={{ color: "var(--accent)" }} />
        <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>{body}</p>
        {action}
      </div>
    </div>
  );
}

export default function CaptionFirstLeftPanel() {
  const activeTool = useEditorStore((s) => s.leftSidebarTab);
  const setLeftSidebarTab = useEditorStore((s) => s.setLeftSidebarTab);
  const setMediaPanelTab = useEditorStore((s) => s.setMediaPanelTab);
  const setRightPanelTab = useEditorStore((s) => s.setRightPanelTab);
  const setShowExportModal = useEditorStore((s) => s.setShowExportModal);

  const renderPanel = () => {
    if (activeTool === "media") {
      return <MediaPanel />;
    }

    if (activeTool === "templates") {
      return (
        <PlaceholderPanel
          title="Styles"
          body="Caption styling is open on the right. Pick a preset, then tune font, background, outline, and placement there."
          action={<button className="btn-primary inline-flex items-center gap-2" onClick={() => setLeftSidebarTab("subtitles")}><Plus size={14} />Open Subtitles</button>}
        />
      );
    }

    return <CaptionEditorPanel key="subtitles-panel" />;
  };

  return (
    <div className="panel flex h-full min-h-0">
      <nav
        className="flex w-[86px] shrink-0 flex-col items-center gap-1 border-r py-2"
        style={{ background: "var(--bg-sidebar)", borderColor: "var(--border-strong)" }}
      >
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            className={`flex w-full flex-col items-center gap-1 px-1 py-2 text-[10px] font-bold ${activeTool === tool.id ? "text-[var(--accent)]" : ""}`}
            style={{ color: activeTool === tool.id ? "var(--accent)" : "var(--text-muted)" }}
            onClick={() => {
              if (tool.id === "export") {
                setShowExportModal(true);
                return;
              }
              if (tool.id === "media") {
                setMediaPanelTab("project");
              }
              if (tool.id === "templates") {
                setRightPanelTab("caption-style");
              }
              if (tool.id === "subtitles") {
                setRightPanelTab("caption-editor");
              }
              setLeftSidebarTab(tool.id);
            }}
            title={tool.label}
          >
            {tool.icon}
            <span>{tool.label}</span>
          </button>
        ))}
      </nav>

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {renderPanel()}
      </div>
    </div>
  );
}
