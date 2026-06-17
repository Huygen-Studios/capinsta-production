/* Huygen Caps - caption-first editor shell */

"use client";

import React, { useEffect } from "react";

import EditorWorkspaceShell from "@/components/editor/EditorWorkspaceShell";
import ExportModal from "@/components/editor/ExportModal";
import SequenceSettingsModal from "@/components/editor/SequenceSettingsModal";
import Toolbar from "@/components/editor/Toolbar";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useEditorStore } from "@/store/editorStore";
import "@/store/projectHistoryStore";
import { useTimelineStore } from "@/store/timelineStore";

export default function EditorApp() {
  useKeyboardShortcuts();

  const initDefaultTracks = useTimelineStore((s) => s.initDefaultTracks);
  const colorMode = useEditorStore((s) => s.colorMode);
  const setColorMode = useEditorStore((s) => s.setColorMode);

  useEffect(() => {
    const tracks = useTimelineStore.getState().tracks;
    if (tracks.length === 0) initDefaultTracks();
  }, [initDefaultTracks]);

  useEffect(() => {
    const stored = window.localStorage.getItem("huygen-caps-theme");
    if (stored === "dark" || stored === "light") {
      setColorMode(stored);
    } else {
      document.documentElement.dataset.theme = "dark";
    }
  }, [setColorMode]);

  useEffect(() => {
    document.documentElement.dataset.theme = colorMode;
    window.localStorage.setItem("huygen-caps-theme", colorMode);
  }, [colorMode]);

  return (
    <div className="editor-shell flex h-[100dvh] w-screen flex-col overflow-hidden" style={{ background: "var(--bg-app)" }}>
      <Toolbar />
      <EditorWorkspaceShell />

      <ExportModal />
      <SequenceSettingsModal />
    </div>
  );
}
