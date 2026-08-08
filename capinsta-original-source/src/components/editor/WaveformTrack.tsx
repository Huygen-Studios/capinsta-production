/* WaveformTrack - clip waveform visualization */

"use client";

import React, { useEffect, useRef } from "react";
import { MediaFile } from "@/lib/types";
import { useEditorStore } from "@/store/editorStore";

interface Props {
  height: number;
  mediaId?: string;
  duration?: number;
}

const waveformCache = new Map<string, Promise<number[]>>();

function fallbackPeaks(seedText: string, peakCount = 900) {
  let seed = 0;
  for (let i = 0; i < seedText.length; i += 1) {
    seed = (seed * 31 + seedText.charCodeAt(i)) >>> 0;
  }

  return Array.from({ length: peakCount }, (_, index) => {
    const t = index / peakCount;
    const carrier = Math.sin((t * 48 + seed * 0.00001) * Math.PI);
    const pulse = Math.sin((t * 9 + 0.2) * Math.PI) * Math.cos((t * 17 + 0.35) * Math.PI);
    return Math.max(0.08, Math.min(0.95, Math.abs(carrier * 0.5 + pulse * 0.35) + 0.12));
  });
}

async function decodeWaveform(media: MediaFile) {
  const cacheKey = `${media.id}:${media.size}:${media.name}`;
  const cached = waveformCache.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    const AudioContextCtor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextCtor) {
      return fallbackPeaks(cacheKey);
    }

    const audioContext = new AudioContextCtor();
    try {
      const buffer = await media.file.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(buffer.slice(0));
      const channels = Math.max(1, audioBuffer.numberOfChannels);
      const sampleCount = audioBuffer.length;
      const peakCount = 1200;
      const blockSize = Math.max(1, Math.floor(sampleCount / peakCount));
      const peaks: number[] = [];

      for (let i = 0; i < peakCount; i += 1) {
        const start = i * blockSize;
        const end = Math.min(sampleCount, start + blockSize);
        let peak = 0;

        for (let channel = 0; channel < channels; channel += 1) {
          const data = audioBuffer.getChannelData(channel);
          for (let sample = start; sample < end; sample += 1) {
            peak = Math.max(peak, Math.abs(data[sample] || 0));
          }
        }

        peaks.push(Math.max(0.03, Math.min(1, peak)));
      }

      return peaks;
    } catch {
      return fallbackPeaks(cacheKey);
    } finally {
      await audioContext.close().catch(() => undefined);
    }
  })();

  waveformCache.set(cacheKey, promise);
  return promise;
}

function drawWaveform(canvas: HTMLCanvasElement, peaks: number[], height: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const canvasHeight = Math.max(1, height || rect.height);

  canvas.width = width * dpr;
  canvas.height = canvasHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, canvasHeight);

  const centerY = canvasHeight / 2;
  const barWidth = width > 420 ? 2 : 1.4;
  const gap = 1;
  const gradient = ctx.createLinearGradient(0, 0, 0, canvasHeight);
  gradient.addColorStop(0, "rgba(117, 188, 255, 0.95)");
  gradient.addColorStop(0.5, "rgba(77, 159, 255, 0.9)");
  gradient.addColorStop(1, "rgba(42, 111, 219, 0.85)");

  ctx.fillStyle = gradient;
  ctx.globalAlpha = 0.88;

  for (let x = 0; x < width; x += barWidth + gap) {
    const peakIndex = Math.min(peaks.length - 1, Math.floor((x / width) * peaks.length));
    const amplitude = Math.max(1, peaks[peakIndex] * centerY * 0.92);
    ctx.fillRect(x, centerY - amplitude, barWidth, amplitude * 2);
  }
}

export default function WaveformTrack({ height, mediaId, duration }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaFiles = useEditorStore((s) => s.mediaFiles);
  const media = mediaFiles.find((file) => file.id === mediaId);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !media) return;

    let cancelled = false;
    drawWaveform(canvas, fallbackPeaks(`${media.id}:${duration || media.duration}`), height);

    decodeWaveform(media).then((peaks) => {
      if (!cancelled) drawWaveform(canvas, peaks, height);
    });

    return () => {
      cancelled = true;
    };
  }, [duration, height, media]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ height }}
      aria-hidden="true"
    />
  );
}
