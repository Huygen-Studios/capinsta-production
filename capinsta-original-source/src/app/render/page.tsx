/* Headless Render Page - pixel-perfect caption frame capture for export */

/* eslint-disable @next/next/no-img-element */

"use client";

import React, { useEffect, useRef, useState } from "react";
import CaptionRenderer from "@/components/captions/CaptionRenderer";
import { normalizeCaptionStyleConfig } from "@/lib/captionStyleConfig";
import { Caption, CaptionStyleConfig, CaptionTheme } from "@/lib/types";

interface CompositionLayerTransform {
  xPercent: number;
  yPercent: number;
  scale: number;
  rotation: number;
  opacity: number;
}

interface CompositionImageLayer {
  id: string;
  type: "image";
  dataUrl: string;
  name?: string;
  start: number;
  end: number;
  zIndex: number;
  transform: CompositionLayerTransform;
}

interface RenderState {
  captions: Caption[];
  theme: CaptionTheme;
  styleConfig: CaptionStyleConfig;
  compositionLayers: CompositionImageLayer[];
  currentTime: number;
  resolution: { width: number; height: number };
  fps: number;
  backgroundColor: string;
  ready: boolean;
}

interface RenderWindow extends Window {
  __RENDER_PAGE_LOADED__?: boolean;
  __CAPTION_DATA_READY__?: boolean;
  HUYGEN_RENDER_MODE?: "full_video" | "captions_only";
  setCaptionData?: (
    captionsJson: string,
    theme: string,
    resWidth?: number,
    resHeight?: number,
    styleConfigJson?: string,
    fps?: number,
    backgroundColor?: string,
    compositionJson?: string,
    renderMode?: "full_video" | "captions_only"
  ) => Promise<boolean>;
  setCaptionTime?: (time: number) => Promise<boolean>;
  isReady?: () => boolean;
}

const DEFAULT_STATE: RenderState = {
  captions: [],
  theme: "word_highlight_box",
  styleConfig: normalizeCaptionStyleConfig(),
  compositionLayers: [],
  currentTime: 0,
  resolution: { width: 1080, height: 1920 },
  fps: 30,
  backgroundColor: "transparent",
  ready: false,
};

function quantizeToFrame(time: number, fps: number) {
  const safeFps = Math.max(1, Number.isFinite(fps) ? fps : 30);
  const frame = Math.max(0, Math.floor(Math.max(0, time) * safeFps + 1e-6));
  return frame / safeFps;
}

function normalizeNumber(value: unknown, fallback: number, min = -Infinity, max = Infinity) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function parseCompositionLayers(compositionJson?: string): CompositionImageLayer[] {
  if (!compositionJson?.trim()) return [];
  const parsed = JSON.parse(compositionJson) as { layers?: unknown[] };
  const layers = Array.isArray(parsed.layers) ? parsed.layers : [];
  return layers
    .map((layer): CompositionImageLayer | null => {
      if (!layer || typeof layer !== "object") return null;
      const value = layer as Record<string, unknown>;
      if (value.type !== "image" || typeof value.dataUrl !== "string") return null;
      const transform = (value.transform && typeof value.transform === "object" ? value.transform : {}) as Record<string, unknown>;
      return {
        id: String(value.id || value.clipId || value.mediaId || Math.random()),
        type: "image",
        dataUrl: value.dataUrl,
        name: typeof value.name === "string" ? value.name : "Image layer",
        start: normalizeNumber(value.start, 0, 0),
        end: normalizeNumber(value.end, Number.MAX_SAFE_INTEGER, 0),
        zIndex: normalizeNumber(value.zIndex, 0),
        transform: {
          xPercent: normalizeNumber(transform.xPercent, 50, -100, 200),
          yPercent: normalizeNumber(transform.yPercent, 50, -100, 200),
          scale: normalizeNumber(transform.scale, 1, 0, 10),
          rotation: normalizeNumber(transform.rotation, 0, -360, 360),
          opacity: normalizeNumber(transform.opacity, 1, 0, 1),
        },
      };
    })
    .filter((layer): layer is CompositionImageLayer => Boolean(layer))
    .sort((a, b) => a.zIndex - b.zIndex);
}

async function preloadImageLayers(layers: CompositionImageLayer[]) {
  await Promise.all(
    layers.map(
      (layer) =>
        new Promise<void>((resolve) => {
          const image = new Image();
          image.onload = () => resolve();
          image.onerror = () => resolve();
          image.src = layer.dataUrl;
        })
    )
  );
}

export default function RenderPage() {
  const [state, setState] = useState<RenderState>(DEFAULT_STATE);
  const readyRef = useRef(false);

  useEffect(() => {
    const win = window as RenderWindow;

    win.setCaptionData = (
      captionsJson: string,
      theme: string,
      resWidth?: number,
      resHeight?: number,
      styleConfigJson?: string,
      fps?: number,
      backgroundColor?: string,
      compositionJson?: string,
      renderMode?: "full_video" | "captions_only"
    ) => {
      return (async () => {
        try {
          const captions = JSON.parse(captionsJson) as Caption[];
          const parsedConfig = styleConfigJson ? JSON.parse(styleConfigJson) : undefined;
          const mode = renderMode === "captions_only" ? "captions_only" : "full_video";
          win.HUYGEN_RENDER_MODE = mode;
          const compositionLayers = mode === "captions_only" ? [] : parseCompositionLayers(compositionJson);
          await preloadImageLayers(compositionLayers);
          readyRef.current = true;
          win.__CAPTION_DATA_READY__ = true;
          setState((prev) => ({
            ...prev,
            captions,
            theme: (theme || "word_highlight_box") as CaptionTheme,
            styleConfig: normalizeCaptionStyleConfig(parsedConfig),
            compositionLayers,
            resolution: {
              width: resWidth && resWidth > 0 ? resWidth : prev.resolution.width,
              height: resHeight && resHeight > 0 ? resHeight : prev.resolution.height,
            },
            fps: fps && fps > 0 ? fps : prev.fps,
            backgroundColor: backgroundColor || "transparent",
            ready: true,
          }));
          await new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())));
          return true;
        } catch (e) {
          console.error("setCaptionData error:", e);
          return false;
        }
      })();
    };

    win.setCaptionTime = (time: number) =>
      new Promise((resolve) => {
        setState((prev) => ({ ...prev, currentTime: quantizeToFrame(time, prev.fps) }));
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
      });

    win.isReady = () => readyRef.current;
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    win.__RENDER_PAGE_LOADED__ = true;
    win.__CAPTION_DATA_READY__ = false;

    return () => {
      delete win.setCaptionData;
      delete win.setCaptionTime;
      delete win.isReady;
      delete win.__RENDER_PAGE_LOADED__;
      delete win.__CAPTION_DATA_READY__;
      delete win.HUYGEN_RENDER_MODE;
      document.body.style.background = "";
      document.documentElement.style.background = "";
    };
  }, []);

  return (
    <div
      id="render-frame"
      style={{
        width: state.resolution.width,
        height: state.resolution.height,
        position: "relative",
        background: state.backgroundColor,
        overflow: "hidden",
      }}
    >
      {state.compositionLayers
        .filter((layer) => state.currentTime >= layer.start && state.currentTime <= layer.end)
        .map((layer) => (
          <img
            key={layer.id}
            src={layer.dataUrl}
            alt={layer.name || ""}
            style={{
              position: "absolute",
              left: `${layer.transform.xPercent}%`,
              top: `${layer.transform.yPercent}%`,
              maxWidth: "70%",
              maxHeight: "70%",
              opacity: layer.transform.opacity,
              transform: `translate(-50%, -50%) scale(${layer.transform.scale}) rotate(${layer.transform.rotation}deg)`,
              transformOrigin: "center center",
              zIndex: layer.zIndex,
              pointerEvents: "none",
            }}
          />
        ))}
      <div style={{ position: "absolute", inset: 0, zIndex: 80 }}>
        <CaptionRenderer
          captions={state.captions}
          currentTime={state.currentTime}
          fps={state.fps}
          scale={1}
          transition={false}
          styleConfig={state.styleConfig}
          canvasSize={state.resolution}
        />
      </div>
    </div>
  );
}
