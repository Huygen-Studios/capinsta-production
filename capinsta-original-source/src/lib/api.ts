/* API client for Huygen Caps backend */

import type { Language, JobResponse } from "@/lib/types";

type ApiResponseType = "json" | "blob";

export interface HealthResponse {
  status: "ok" | "degraded" | string;
  version: string;
  stt_provider?: string | null;
  provider_keys?: Record<string, boolean>;
  dependencies?: Record<string, boolean | string>;
  max_upload_mb?: number;
  render_page_url?: string;
  message?: string | null;
}

export class ApiError extends Error {
  status?: number;
  details?: unknown;

  constructor(message: string, status?: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export interface UploadJobResponse {
  job_id: string;
  status: string;
  progress: number;
  filename: string;
  target_lang: string;
  languageMode: Language;
  video_url?: string;
}

export interface ExportMp4Response {
  success: true;
  exportJobId: string;
  downloadUrl: string;
  filename: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  bytes?: number;
}

export interface StartExportJobResponse {
  success: true;
  jobId: string;
  statusUrl: string;
  message: string;
}

export interface ExportJobStatusResponse {
  jobId: string;
  sourceJobId: string;
  status: "queued" | "running" | "completed" | "failed";
  stage: string;
  progress: number;
  message?: string;
  error?: string | null;
  downloadUrl?: string | null;
  filename?: string | null;
  bytes?: number | null;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface SyncRequestPayload {
  shiftSeconds: number;
  skew: number;
  anchorSeconds: number;
  startRange?: number | null;
  endRange?: number | null;
}

export interface SyncResponse {
  jobId: string;
  applied?: boolean;
  segments?: unknown[];
  transcript?: Record<string, unknown>;
  srt?: string;
  vtt?: string;
  report?: Record<string, unknown>;
  timingReport?: Record<string, unknown>;
  userMessage?: string;
  rejectReason?: string;
  estimatedWordCount?: number;
  timingNeedsReviewCount?: number;
  beforeFirst10Words?: unknown[];
  afterFirst10Words?: unknown[];
  validationWarnings?: string[];
  recommendation?: Record<string, unknown>;
}

interface HeadlessExportOptions {
  width?: number;
  height?: number;
  fps?: number;
  includeAudio?: boolean;
  captionsOnly?: boolean;
  quality?: string;
  bitrate?: string;
  customBitrateMbps?: number;
  exportMode?: "full_video" | "captions_only";
  backgroundColor?: string;
  duration?: number;
  durationSource?: string;
  visibleTracksCount?: number;
  sourceMediaCount?: number;
  captionChunksCount?: number;
  hardwareAcceleration?: boolean;
  compositionJson?: string;
}

const configuredApiBase = (process.env.NEXT_PUBLIC_API_URL || "").trim().replace(/\/+$/, "");

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function runtimeApiBase() {
  if (configuredApiBase) return configuredApiBase;

  if (typeof window !== "undefined") {
    const { hostname, port } = window.location;
    const localFrontendPort = port && port !== "8000" && port !== "10000";
    if (isLocalHost(hostname) && localFrontendPort) {
      return "http://127.0.0.1:8000";
    }
  }

  if (process.env.NODE_ENV === "development") return "http://127.0.0.1:8000";
  return "";
}

function apiLabel() {
  return runtimeApiBase() || "this Render service";
}

function apiUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  const base = runtimeApiBase();
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function websocketBase() {
  const base = runtimeApiBase();
  if (base) return base.replace(/^http/i, "ws");
  if (typeof window === "undefined") return "";
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}`;
}

function summarizeHtmlError(text: string, res: Response) {
  const url = new URL(res.url);
  const title = text.match(/<title>(.*?)<\/title>/i)?.[1]?.trim();
  const next404 = res.status === 404 && text.includes("This page could not be found");
  if (next404 && url.pathname.startsWith("/api")) {
    return (
      `Backend API route ${url.pathname} returned a Next.js 404 page. ` +
      "The editor is calling the frontend server instead of FastAPI. " +
      `Start the backend on ${apiLabel()}, refresh the editor, or set NEXT_PUBLIC_API_URL to the backend URL.`
    );
  }
  if (title) return `${res.status} ${res.statusText}: ${title}`;
  return `${res.status} ${res.statusText}`.trim();
}

async function readError(res: Response) {
  const fallback = `${res.status} ${res.statusText}`.trim();
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text().catch(() => "");
    const message = contentType.includes("text/html") && text ? summarizeHtmlError(text, res) : text || fallback;
    return { message, details: text ? text.slice(0, 1200) : fallback };
  }

  const payload = await res.json().catch(() => null);
  if (payload?.success === false && payload?.stage && payload?.error) {
    return {
      message: `Export failed during ${payload.stage}: ${payload.error}`,
      details: payload,
    };
  }
  if (payload?.detail?.success === false && payload.detail.stage && payload.detail.error) {
    return {
      message: `Export failed during ${payload.detail.stage}: ${payload.detail.error}`,
      details: payload.detail,
    };
  }
  const detail = payload?.detail || payload?.message || payload?.error || payload;
  const message =
    typeof detail === "string"
      ? detail
      : detail
      ? JSON.stringify(detail)
      : fallback;
  return { message, details: payload };
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 30000,
  responseType: ApiResponseType = "json",
  externalSignal?: AbortSignal
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const abortFromExternalSignal = () => controller.abort();

  if (externalSignal?.aborted) {
    controller.abort();
  } else {
    externalSignal?.addEventListener("abort", abortFromExternalSignal, { once: true });
  }

  try {
    const res = await fetch(apiUrl(path), {
      ...options,
      signal: controller.signal,
    });

    if (!res.ok) {
      const err = await readError(res);
      throw new ApiError(err.message, res.status, err.details);
    }

    if (responseType === "blob") return (await res.blob()) as T;
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(
        externalSignal?.aborted
          ? "Request cancelled."
          : `Request to ${apiLabel()} timed out after ${Math.round(timeoutMs / 1000)}s.`
      );
    }
    throw new ApiError(
      `Backend is unreachable. Check API URL and /health. Tried ${apiLabel()}. ` +
        (process.env.NODE_ENV === "development"
          ? `Start the FastAPI server at ${apiLabel()}, allow this frontend origin in CORS, or set NEXT_PUBLIC_API_URL.`
          : "Check /api/health, CORS origins, and confirm NEXT_PUBLIC_API_URL is only used for a separate backend.")
    );
  } finally {
    window.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternalSignal);
  }
}

export function getApiBaseUrl() {
  return runtimeApiBase() || "";
}

export function resolveBackendUrl(path: string) {
  return apiUrl(path);
}

export async function uploadVideo(
  file: File,
  languageMode: string = "auto_mixed_indian",
  signal?: AbortSignal
): Promise<UploadJobResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("languageMode", languageMode);

  return apiFetch<UploadJobResponse>(
    "/api/jobs",
    {
      method: "POST",
      body: formData,
    },
    120000,
    "json",
    signal
  );
}

export async function getJob(jobId: string): Promise<JobResponse> {
  return apiFetch<JobResponse>(`/api/jobs/${jobId}`, {}, 30000);
}

export async function cancelJob(jobId: string): Promise<JobResponse> {
  return apiFetch<JobResponse>(`/api/jobs/${jobId}/cancel`, { method: "POST" }, 30000);
}

export async function getJobs(): Promise<JobResponse[]> {
  return apiFetch<JobResponse[]>("/api/jobs", {}, 30000);
}

export async function getHealth() {
  return apiFetch<HealthResponse>("/api/health", {}, 8000);
}

export async function getExportHealth() {
  return apiFetch<Record<string, unknown>>("/api/health/export", {}, 8000);
}

export async function getTimingDebug(jobId: string, currentTime?: number) {
  const query = typeof currentTime === "number" && Number.isFinite(currentTime) ? `?currentTime=${encodeURIComponent(currentTime.toFixed(3))}` : "";
  return apiFetch<Record<string, unknown>>(`/api/jobs/${jobId}/timing-debug${query}`, {}, 30000);
}

export async function previewCaptionSync(jobId: string, payload: SyncRequestPayload): Promise<SyncResponse> {
  return apiFetch<SyncResponse>(
    `/api/jobs/${jobId}/sync/preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    30000
  );
}

export async function applyCaptionSync(jobId: string, payload: SyncRequestPayload): Promise<SyncResponse> {
  return apiFetch<SyncResponse>(
    `/api/jobs/${jobId}/sync/apply`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    60000
  );
}

export async function autoFixCaptionSync(jobId: string): Promise<SyncResponse> {
  return apiFetch<SyncResponse>(`/api/jobs/${jobId}/sync/auto`, { method: "POST" }, 120000);
}

export async function runHighQualityAlignment(jobId: string): Promise<SyncResponse> {
  try {
    return await apiFetch<SyncResponse>(`/api/jobs/${jobId}/sync/high-quality-align`, { method: "POST" }, 10 * 60 * 1000);
  } catch (error) {
    if (error instanceof ApiError && error.details && typeof error.details === "object") {
      const details = error.details as SyncResponse;
      if (details.userMessage || details.report) return details;
    }
    throw error;
  }
}

export function createProgressWebSocket(
  jobId: string,
  onMessage: (data: { status: string; percent: number; details: string }) => void,
  onClose?: () => void
): WebSocket {
  const ws = new WebSocket(`${websocketBase()}/api/jobs/${jobId}/ws`);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch {
      // ignore parse errors
    }
  };

  ws.onclose = () => onClose?.();
  ws.onerror = () => ws.close();

  return ws;
}

export function getVideoStreamUrl(jobId: string): string {
  return apiUrl(`/api/jobs/${jobId}/video`);
}

export async function exportBurnedMp4(jobId: string, assContent: string, resolution: string = "1080p"): Promise<Blob> {
  const formData = new FormData();
  formData.append("ass_content", assContent);
  formData.append("resolution", resolution);
  formData.append("render_mode", "ass");

  return apiFetch<Blob>(
    `/api/jobs/${jobId}/export`,
    {
      method: "POST",
      body: formData,
    },
    30 * 60 * 1000,
    "blob"
  );
}

/**
 * Pixel-perfect headless browser export.
 * Sends raw captions JSON + theme so the backend can render frames
 * using the exact same CSS styling as the editor preview.
 */
export async function exportHeadless(
  jobId: string,
  captionsJson: string,
  theme: string,
  resolution: string = "1080p",
  styleConfigJson?: string,
  options?: HeadlessExportOptions
): Promise<ExportMp4Response> {
  const formData = buildHeadlessExportFormData(captionsJson, theme, resolution, styleConfigJson, options);
  formData.append("response_format", "json");

  return apiFetch<ExportMp4Response>(
    `/api/jobs/${jobId}/export`,
    {
      method: "POST",
      body: formData,
    },
    30 * 60 * 1000,
    "json"
  );
}

function buildHeadlessExportFormData(
  captionsJson: string,
  theme: string,
  resolution: string,
  styleConfigJson?: string,
  options?: HeadlessExportOptions
) {
  const formData = new FormData();
  formData.append("captions_json", captionsJson);
  formData.append("theme", theme);
  formData.append("resolution", resolution);
  formData.append("render_mode", "headless");
  if (options?.width) formData.append("export_width", String(options.width));
  if (options?.height) formData.append("export_height", String(options.height));
  if (options?.fps) formData.append("export_fps", String(options.fps));
  if (typeof options?.includeAudio === "boolean") formData.append("include_audio", String(options.includeAudio));
  if (typeof options?.captionsOnly === "boolean") formData.append("captions_only", String(options.captionsOnly));
  if (options?.quality) formData.append("quality", options.quality);
  if (options?.bitrate) formData.append("bitrate", options.bitrate);
  if (options?.customBitrateMbps) formData.append("custom_bitrate_mbps", String(options.customBitrateMbps));
  if (options?.exportMode) formData.append("export_mode", options.exportMode);
  if (options?.backgroundColor) formData.append("background_color", options.backgroundColor);
  if (options?.duration) formData.append("duration_override", String(options.duration));
  if (options?.duration) formData.append("custom_duration", String(options.duration));
  if (options?.durationSource) formData.append("duration_source", options.durationSource);
  if (options?.durationSource) formData.append("duration_mode", options.durationSource);
  if (typeof options?.visibleTracksCount === "number") formData.append("visible_tracks_count", String(options.visibleTracksCount));
  if (typeof options?.sourceMediaCount === "number") formData.append("source_media_count", String(options.sourceMediaCount));
  if (typeof options?.captionChunksCount === "number") formData.append("caption_chunks_count", String(options.captionChunksCount));
  if (typeof options?.hardwareAcceleration === "boolean") formData.append("hardware_acceleration", String(options.hardwareAcceleration));
  if (options?.compositionJson) formData.append("composition_json", options.compositionJson);
  if (styleConfigJson) {
    formData.append("style_config_json", styleConfigJson);
  }
  return formData;
}

export async function startHeadlessExportJob(
  sourceJobId: string,
  captionsJson: string,
  theme: string,
  resolution: string = "1080p",
  styleConfigJson?: string,
  options?: HeadlessExportOptions
): Promise<StartExportJobResponse> {
  const formData = buildHeadlessExportFormData(captionsJson, theme, resolution, styleConfigJson, options);
  formData.append("source_job_id", sourceJobId);

  return apiFetch<StartExportJobResponse>(
    "/api/export/jobs",
    {
      method: "POST",
      body: formData,
    },
    45 * 1000,
    "json"
  );
}

export async function getExportJobStatus(exportJobIdOrStatusUrl: string): Promise<ExportJobStatusResponse> {
  const path = exportJobIdOrStatusUrl.startsWith("/api/")
    ? exportJobIdOrStatusUrl
    : `/api/export/jobs/${exportJobIdOrStatusUrl}`;
  return apiFetch<ExportJobStatusResponse>(path, {}, 15 * 1000, "json");
}
