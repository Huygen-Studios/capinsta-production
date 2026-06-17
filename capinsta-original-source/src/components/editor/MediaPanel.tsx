/* MediaPanel - caption-first media import panel */
/* eslint-disable @next/next/no-img-element */

"use client";

import React, { useCallback } from "react";
import { Film, FolderOpen, Image as ImageIcon, Music, Plus, Trash2, UploadCloud } from "lucide-react";
import { useEditorStore } from "@/store/editorStore";
import { useCaptionStore } from "@/store/captionStore";
import { useTimelineStore } from "@/store/timelineStore";
import { importMediaFile, openMediaPicker } from "@/lib/mediaImport";

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(secs: number) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function iconForType(type: string) {
  if (type === "video") return <Film size={14} />;
  if (type === "audio") return <Music size={14} />;
  return <ImageIcon size={14} />;
}

export default function MediaPanel() {
  const {
    mediaFiles,
    activeMediaId,
    removeMedia,
    setActiveMedia,
  } = useEditorStore();
  const captions = useCaptionStore((s) => s.captions);
  const setCaptions = useCaptionStore((s) => s.setCaptions);
  const removeClipsByMediaId = useTimelineStore((s) => s.removeClipsByMediaId);

  const handleImport = useCallback(() => {
    void openMediaPicker();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) {
        void importMediaFile(file);
      }
    },
    []
  );

  return (
    <div className="panel flex flex-col h-full">
      <div className="panel-header justify-between">
        <span>Media</span>
        <span className="count-badge">{mediaFiles.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
          <div onDragOver={(e) => e.preventDefault()} onDrop={handleDrop} className="min-h-full">
            <button
              className="btn-primary mb-3 flex w-full items-center justify-center gap-2 py-3"
              onClick={handleImport}
            >
              <UploadCloud size={15} />
              Import Video
            </button>

            {mediaFiles.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-2 p-2 rounded cursor-pointer transition-colors mb-1"
                draggable
                onClick={() => setActiveMedia(f.id)}
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-huygen-caps-media", f.id);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                style={{
                  background: activeMediaId === f.id ? "var(--bg-panel-hover)" : "var(--bg-panel-raised)",
                  border: activeMediaId === f.id ? "2px solid var(--accent)" : "2px solid var(--border-subtle)",
                }}
              >
                <span style={{ color: "var(--accent)" }}>{iconForType(f.type)}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs truncate" style={{ color: "var(--text-primary)" }}>
                    {f.name}
                  </div>
                  <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {f.duration > 0 && `${formatDuration(f.duration)} - `}
                    {formatSize(f.size)}
                    {f.resolution && ` - ${f.resolution.width}x${f.resolution.height}`}
                  </div>
                </div>
                <button
                  className="p-1 rounded hover:bg-[var(--hover-surface)]"
                  onClick={(e) => {
                    e.stopPropagation();
                    const ok = window.confirm(
                      "Delete media asset? Existing generated captions will be kept. Timeline clips using this media may be removed."
                    );
                    if (!ok) return;
                    removeMedia(f.id);
                    removeClipsByMediaId(f.id);
                    setCaptions(captions.map((caption) => (
                      caption.sourceMediaId === f.id ? { ...caption, sourceMediaId: undefined } : caption
                    )));
                  }}
                  title="Delete media"
                >
                  <Trash2 size={12} style={{ color: "var(--text-muted)" }} />
                </button>
              </div>
            ))}

            <button
              className="flex items-center gap-2 w-full p-2 mt-2 rounded text-xs transition-colors"
              style={{ border: "1px dashed var(--border)", color: "var(--text-muted)" }}
              onClick={handleImport}
            >
              <Plus size={14} />
              Import Media
            </button>

            {mediaFiles.length === 0 && (
              <div className="brutal-empty flex flex-col items-center justify-center py-8 text-center">
                <img
                  className="empty-logo"
                  src="/brand/huygen-logo.png"
                  alt="Huygen Caps"
                  width={96}
                  height={73}
                  style={{ width: 96, maxWidth: 96, height: "auto", objectFit: "contain" }}
                />
                <FolderOpen size={26} style={{ color: "var(--accent)" }} className="mb-2" />
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Import a video to start captioning.
                  <br />
                  Drag a file here or click Import Video.
                </p>
              </div>
            )}
          </div>
      </div>
    </div>
  );
}
