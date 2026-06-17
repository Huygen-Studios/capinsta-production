"use client";

import React from "react";
import { Captions, Download, Film, Mic2, Music, Palette, SlidersHorizontal, Sparkles, Type, Wand2 } from "lucide-react";

export type MobileTool = "audio" | "text" | "voice" | "media" | "captions" | "style" | "effects" | "colors" | "adjust" | "export";

const TOOLS: { id: MobileTool; label: string; icon: React.ReactNode }[] = [
  { id: "audio", label: "Audio", icon: <Music size={19} /> },
  { id: "text", label: "Text", icon: <Type size={19} /> },
  { id: "voice", label: "Voice", icon: <Mic2 size={19} /> },
  { id: "media", label: "Media", icon: <Film size={19} /> },
  { id: "captions", label: "Captions", icon: <Captions size={19} /> },
  { id: "style", label: "Style", icon: <Palette size={19} /> },
  { id: "effects", label: "Effects", icon: <Sparkles size={19} /> },
  { id: "colors", label: "Colors", icon: <Wand2 size={19} /> },
  { id: "adjust", label: "Adjust", icon: <SlidersHorizontal size={19} /> },
  { id: "export", label: "Export", icon: <Download size={19} /> },
];

export default function MobileBottomToolbar({ activeTool, onSelect }: { activeTool: MobileTool | null; onSelect: (tool: MobileTool) => void }) {
  return (
    <nav className="mobile-bottom-toolbar" aria-label="Mobile editor tools">
      {TOOLS.map((tool) => (
        <button key={tool.id} className={activeTool === tool.id ? "active" : ""} onClick={() => onSelect(tool.id)}>
          {tool.icon}
          <span>{tool.label}</span>
        </button>
      ))}
    </nav>
  );
}
