/* Toolbar - caption-first top chrome */
/* eslint-disable @next/next/no-img-element */

"use client";

import React from "react";
import { Download, Moon, Redo2, RotateCcw, Save, Sun, Undo2, UploadCloud } from "lucide-react";
import { useEditorStore } from "@/store/editorStore";
import { useProjectHistoryStore } from "@/store/projectHistoryStore";
import { openMediaPicker } from "@/lib/mediaImport";
import { RESET_PANEL_LAYOUT_EVENT } from "@/hooks/usePanelLayoutPersistence";

export default function Toolbar() {
  const {
    colorMode,
    setColorMode,
    setLeftSidebarTab,
    setMediaPanelTab,
    setShowExportModal,
  } = useEditorStore();
  const { undo, redo, canUndo, canRedo } = useProjectHistoryStore();

  const openImport = () => {
    setLeftSidebarTab("media");
    setMediaPanelTab("project");
    void openMediaPicker();
  };

  const resetPanelLayout = () => {
    window.dispatchEvent(new CustomEvent(RESET_PANEL_LAYOUT_EVENT));
  };

  return (
    <div className="toolbar-shell flex h-12 min-w-0 shrink-0 select-none items-center gap-2 overflow-hidden px-2">
      <div className="brand-mark mr-1 min-w-0 shrink">
        <img
          className="brand-logo"
          src="/brand/huygen-logo.png"
          alt="Huygen Caps"
          width={30}
          height={30}
          style={{ width: 30, height: 30, maxWidth: 30, maxHeight: 30, objectFit: "contain" }}
        />
        <span className="brand-name truncate">Huygen Caps</span>
      </div>

      <button
        className="toolbar-import btn-ghost inline-flex shrink-0 items-center gap-2"
        style={{ background: "var(--bg-control)", color: "var(--text-muted)", borderColor: "var(--border-strong)" }}
        onClick={openImport}
        title="Import Video"
      >
        <UploadCloud size={14} />
        <span className="toolbar-button-label">Import Video</span>
      </button>

      <div className="toolbar-badge hidden rounded px-2 py-1 text-[10px] font-bold uppercase sm:block" style={{ color: "var(--text-muted)", background: "var(--bg-control)", border: "1px solid var(--border)" }}>
        Caption Generator
      </div>

      <button className="icon-button hidden sm:inline-grid" disabled={!canUndo} onClick={undo} title="Undo">
        <Undo2 size={15} />
      </button>
      <button className="icon-button hidden sm:inline-grid" disabled={!canRedo} onClick={redo} title="Redo">
        <Redo2 size={15} />
      </button>

      <div className="flex-1" />

      <span className="hidden text-[11px] xl:inline" style={{ color: "var(--text-muted)" }}>
        Last edited a few seconds ago
      </span>

      <button className="icon-button hidden sm:inline-grid" title="Save project">
        <Save size={15} />
      </button>
      <button className="icon-button hidden sm:inline-grid" onClick={resetPanelLayout} title="Reset panel layout">
        <RotateCcw size={15} />
      </button>
      <button
        className="icon-button"
        onClick={() => setColorMode(colorMode === "dark" ? "light" : "dark")}
        title={colorMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      >
        {colorMode === "dark" ? <Sun size={15} /> : <Moon size={15} />}
      </button>
      <button className="toolbar-export btn-primary inline-flex shrink-0 items-center gap-2" onClick={() => setShowExportModal(true)} title="Export Project">
        <span className="toolbar-export-label">Export Project</span>
        <Download size={14} />
      </button>
    </div>
  );
}
