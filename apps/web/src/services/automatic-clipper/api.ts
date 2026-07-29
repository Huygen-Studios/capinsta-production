/* eslint-disable opencut/prefer-object-params -- Public client helpers mirror their REST route parameters. */
import { buildCapinstaApiUrl, buildCapinstaHealthUrl } from "@/capinsta/api-url";
import { getCapinstaApiBaseUrl } from "@/capinsta/featureFlags";
import { authenticatedFetch } from "@/lib/supabase/authenticated-fetch";
import { z } from "zod";

export type ClipperLayoutStrategy =
	| "automatic"
	| "preserve_vertical"
	| "single_subject_crop"
	| "dual_subject_split"
	| "speaker_screen_stack"
	| "fit_blurred_background"
	| "manual_safe_crop";

export interface ViralCandidate {
	candidateId: string;
	sourceStartMs: number;
	sourceEndMs: number;
	durationMs: number;
	title: string;
	hookText: string;
	supportingEmojis: string[];
	viralScore: number;
	scoreBreakdown: {
		hookStrength: number;
		clarity: number;
		payoff: number;
		emotion: number;
		novelty: number;
	};
	reason: string;
	transcriptEvidence: {
		wordIds: string[];
		segmentIds: string[];
		excerpt: string;
	};
	recommendedFramingStrategy: ClipperLayoutStrategy;
	recommendedCaptionPreset: string;
	warnings: string[];
	status: "proposed" | "selected" | "rejected" | "superseded";
	projectRevision: number;
	selectedProjectRevision: number | null;
}

export interface WorkflowSnapshot {
	status: "processing" | "candidate_review";
	mediaAssetId: string;
	projectId: string | null;
	projectRevision: number | null;
	transcriptId: string | null;
	stages: Record<string, unknown>;
}

export interface ClipperSelection {
	expectedRevision: number;
	hookText?: string;
	supportingEmojis?: string[];
	framingStrategy: ClipperLayoutStrategy;
	captionPreset: string;
	wordSpacing: number;
	safeZoneProfile:
		| "shorts-generic-v1"
		| "tiktok-v1"
		| "reels-v1"
		| "youtube-shorts-v1";
}

const layoutStrategySchema = z.enum([
	"automatic",
	"preserve_vertical",
	"single_subject_crop",
	"dual_subject_split",
	"speaker_screen_stack",
	"fit_blurred_background",
	"manual_safe_crop",
]);

export function isClipperLayoutStrategy(
	value: string,
): value is ClipperLayoutStrategy {
	return layoutStrategySchema.safeParse(value).success;
}

export const viralCandidateSchema = z
	.object({
		candidateId: z.string().min(1),
		sourceStartMs: z.number().int().nonnegative(),
		sourceEndMs: z.number().int().positive(),
		durationMs: z.number().int().positive(),
		title: z.string().max(120),
		hookText: z.string().max(120),
		supportingEmojis: z.array(z.string()).max(2),
		viralScore: z.number().int().min(0).max(100),
		scoreBreakdown: z.object({
			hookStrength: z.number().int().min(0).max(20),
			clarity: z.number().int().min(0).max(20),
			payoff: z.number().int().min(0).max(20),
			emotion: z.number().int().min(0).max(20),
			novelty: z.number().int().min(0).max(20),
		}),
		reason: z.string(),
		transcriptEvidence: z.object({
			wordIds: z.array(z.string()),
			segmentIds: z.array(z.string()),
			excerpt: z.string(),
		}),
		recommendedFramingStrategy: layoutStrategySchema,
		recommendedCaptionPreset: z.string().min(1),
		warnings: z.array(z.string()),
		status: z.enum(["proposed", "selected", "rejected", "superseded"]),
		projectRevision: z.number().int().positive(),
		selectedProjectRevision: z.number().int().positive().nullable(),
	})
	.strict()
	.refine(
		(value) =>
			value.sourceEndMs > value.sourceStartMs &&
			value.durationMs === value.sourceEndMs - value.sourceStartMs,
		"Candidate timing is inconsistent.",
	);

const workflowSnapshotSchema = z.object({
	status: z.enum(["processing", "candidate_review"]),
	mediaAssetId: z.string().min(1),
	projectId: z.string().nullable(),
	projectRevision: z.number().int().positive().nullable(),
	transcriptId: z.string().nullable(),
	stages: z.record(z.string(), z.unknown()),
});
const unknownRecordSchema = z.record(z.string(), z.unknown());
const uploadInstructionsSchema = z.object({
	mediaAssetId: z.string().min(1),
	uploadSessionId: z.string().min(1),
	uploadUrl: z.url(),
	requiredHeaders: z.record(z.string(), z.string()),
	uploadMetadata: z.record(z.string(), z.string()),
});
const selectionResultSchema = z.object({
	jobId: z.string().optional(),
	status: z.string(),
	projectRevision: z.number().int().positive(),
});
const queuedJobSchema = z.object({
	jobId: z.string().optional(),
	status: z.string(),
});
const projectJobSchema = z.object({
	status: z.string(),
	progress: z.number(),
	current_stage: z.string().nullable(),
	output: z
		.object({ projectRevision: z.number().int().positive().optional() })
		.optional(),
	failure_message: z.string().nullable().optional(),
});
const conversionResultSchema = z.object({ jobId: z.string().min(1) });
const exportResultSchema = z.object({
	exportId: z.string().min(1),
	status: z.string(),
});
const downloadResultSchema = z.object({ url: z.url() });
const handoffResultSchema = z.object({ handoffId: z.string().min(1) });

export function parseCandidates(value: unknown): ViralCandidate[] {
	return z.array(viralCandidateSchema).parse(value) as ViralCandidate[];
}

function endpoint(path: string): string {
	return buildCapinstaApiUrl({ baseUrl: getCapinstaApiBaseUrl(), path });
}

async function ensureClipperBackendReady(signal?: AbortSignal) {
	const url = buildCapinstaHealthUrl({ baseUrl: getCapinstaApiBaseUrl() });
	let response: Response;
	try {
		response = await fetch(url, { signal });
	} catch (error) {
		if (signal?.aborted) throw error;
		throw new Error("The video-processing service is unavailable.");
	}
	const body: unknown = await response.json().catch(() => null);
	if (!response.ok) throw new Error("The video-processing service is unavailable.");
	if (typeof body !== "object" || body === null) return;
	const contractVersion = Reflect.get(body, "apiContractVersion");
	if (typeof contractVersion === "number" && contractVersion !== 1)
		throw new Error(
			"The web and processing services are running different releases. Redeploy both services using the same image tag.",
		);
	const capabilities = Reflect.get(body, "capabilities");
	if (
		Array.isArray(capabilities) &&
		!capabilities.includes("clipping-media-uploads")
	) {
		throw new Error(
			"The web and processing services are running different releases. Redeploy both services using the same image tag.",
		);
	}
}

function key(scope: string): string {
	return `${scope}:${crypto.randomUUID()}`;
}

async function json(path: string, init?: RequestInit): Promise<unknown> {
	const url = endpoint(path);
	let response: Response;
	try {
		response = await authenticatedFetch(url, init);
	} catch (error) {
		if (init?.signal?.aborted) throw error;
		throw new Error("The video-processing service is unavailable.");
	}
	const body: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		const objectBody = typeof body === "object" && body !== null ? body : null;
		const detail = objectBody ? Reflect.get(objectBody, "detail") : null;
		const error = objectBody ? Reflect.get(objectBody, "error") : null;
		const code =
			(objectBody ? Reflect.get(objectBody, "code") : null) ??
			(typeof detail === "object" && detail !== null
				? Reflect.get(detail, "code")
				: null) ??
			(typeof error === "object" && error !== null
				? Reflect.get(error, "code")
				: null);
		const message =
			code === "backend_unreachable" || response.status >= 500
				? "The video-processing service is unavailable."
				: code === "storage_not_configured"
					? "Clipper Storage is not configured. Apply the Storage migration."
					: code === "uploads_disabled"
						? "New uploads are temporarily paused."
						: response.status === 401
							? "Your session expired. Sign in again."
							: response.status === 403
								? "You do not have permission to use this feature."
								: response.status === 404
									? "The deployed web and API versions do not match. Redeploy both services using the same image tag."
									: typeof detail === "object" && detail !== null
										? Reflect.get(detail, "message")
										: detail;
		throw new Error(
			typeof message === "string"
				? message
				: "The clipper request could not be completed.",
		);
	}
	return body;
}

function encodeTusMetadata(metadata: Record<string, string>): string {
	return Object.entries(metadata)
		.map(([name, value]) => {
			const bytes = new TextEncoder().encode(value);
			let binary = "";
			for (const byte of bytes) binary += String.fromCharCode(byte);
			return `${name} ${btoa(binary)}`;
		})
		.join(",");
}

async function uploadFingerprint(file: File): Promise<string> {
	const value = new TextEncoder().encode(
		`${file.name}\0${file.size}\0${file.lastModified}\0${file.type}`,
	);
	const digest = await crypto.subtle.digest("SHA-256", value);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

async function patchTusChunk(
	url: string,
	init: RequestInit,
): Promise<Response> {
	const delays = [0, 3_000, 5_000, 10_000, 20_000];
	let response: Response | null = null;
	let lastError: unknown;
	for (const delay of delays) {
		if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
		try {
			response = await fetch(url, init);
		} catch (error) {
			if (init.signal?.aborted) throw error;
			lastError = error;
			continue;
		}
		if (
			response.ok ||
			![408, 429, 500, 502, 503, 504].includes(response.status)
		) {
			return response;
		}
	}
	if (response) return response;
	throw lastError;
}

export async function uploadClipperMedia({
	file,
	onProgress,
	signal,
}: {
	file: File;
	onProgress: (progress: number) => void;
	signal?: AbortSignal;
}): Promise<string> {
	type UploadInstructions = {
		mediaAssetId: string;
		uploadSessionId: string;
		uploadUrl: string;
		requiredHeaders: Record<string, string>;
		uploadMetadata: Record<string, string>;
		uploadLocation: string;
	};
	const fingerprint = await uploadFingerprint(file);
	const resumeKey = `capinsta:clipper:tus-v1:${fingerprint}`;
	let instructions: UploadInstructions | null = null;
	try {
		instructions = JSON.parse(window.localStorage.getItem(resumeKey) ?? "null");
	} catch {
		window.localStorage.removeItem(resumeKey);
	}
	let offset = 0;
	if (instructions) {
		const resume = await fetch(instructions.uploadLocation, {
			method: "HEAD",
			headers: {
				...instructions.requiredHeaders,
				"Tus-Resumable": "1.0.0",
			},
			signal,
		});
		if (resume.ok) {
			offset = Number(resume.headers.get("upload-offset") ?? 0);
			if (!Number.isSafeInteger(offset) || offset < 0 || offset > file.size) {
				throw new Error("The resumable upload returned an invalid offset.");
			}
			onProgress(Math.round((offset / file.size) * 100));
		} else {
			window.localStorage.removeItem(resumeKey);
			instructions = null;
		}
	}
	if (!instructions) {
		await ensureClipperBackendReady(signal);
		const createdInstructions = uploadInstructionsSchema.parse(
			await json("/clipping/media/uploads", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": `clipper-upload:${fingerprint}`,
				},
				body: JSON.stringify({
					displayName: file.name,
					mimeType: file.type || "video/mp4",
					sizeBytes: file.size,
				}),
				signal,
			}),
		);
		const create = await fetch(createdInstructions.uploadUrl, {
			method: "POST",
			headers: {
				...createdInstructions.requiredHeaders,
				"Tus-Resumable": "1.0.0",
				"Upload-Length": String(file.size),
				"Upload-Metadata": encodeTusMetadata(
					createdInstructions.uploadMetadata,
				),
			},
			signal,
		});
		if (!create.ok) throw new Error("The resumable upload could not start.");
		const location = create.headers.get("location");
		if (!location)
			throw new Error("The upload server did not return a resume URL.");
		instructions = {
			...createdInstructions,
			uploadLocation: new URL(
				location,
				createdInstructions.uploadUrl,
			).toString(),
		};
		window.localStorage.setItem(resumeKey, JSON.stringify(instructions));
	}
	const chunkSize = 6 * 1024 * 1024;
	while (offset < file.size) {
		const chunk = file.slice(offset, Math.min(file.size, offset + chunkSize));
		const response = await patchTusChunk(instructions.uploadLocation, {
			method: "PATCH",
			headers: {
				...instructions.requiredHeaders,
				"Tus-Resumable": "1.0.0",
				"Upload-Offset": String(offset),
				"Content-Type": "application/offset+octet-stream",
			},
			body: chunk,
			signal,
		});
		if (!response.ok) throw new Error("The resumable upload was interrupted.");
		offset = Number(
			response.headers.get("upload-offset") ?? offset + chunk.size,
		);
		onProgress(Math.min(100, Math.round((offset / file.size) * 100)));
	}
	await json(
		`/clipping/media/uploads/${instructions.uploadSessionId}/complete`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ createProbeJob: true }),
			signal,
		},
	);
	window.localStorage.removeItem(resumeKey);
	return instructions.mediaAssetId;
}

export async function advanceWorkflow(
	mediaAssetId: string,
): Promise<WorkflowSnapshot> {
	const value = await json(
		`/clipping/workflows/${encodeURIComponent(mediaAssetId)}/advance`,
		{
			method: "POST",
		},
	);
	return workflowSnapshotSchema.parse(value);
}

export async function listCandidates(
	projectId: string,
): Promise<ViralCandidate[]> {
	const body = z
		.object({ items: z.array(viralCandidateSchema) })
		.parse(
			await json(
				`/clipping/projects/${encodeURIComponent(projectId)}/candidates`,
			),
		);
	return parseCandidates(body.items);
}

export async function selectCandidate(
	projectId: string,
	candidateId: string,
	selection: ClipperSelection,
): Promise<{ jobId?: string; status: string; projectRevision: number }> {
	return selectionResultSchema.parse(
		await json(
			`/clipping/projects/${encodeURIComponent(projectId)}/candidates/${encodeURIComponent(candidateId)}/select`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": key("candidate-select"),
				},
				body: JSON.stringify(selection),
			},
		),
	);
}

export function rejectCandidate(
	projectId: string,
	candidateId: string,
	expectedRevision: number,
): Promise<unknown> {
	return json(
		`/clipping/projects/${encodeURIComponent(projectId)}/candidates/${encodeURIComponent(candidateId)}/reject`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": key("candidate-reject"),
			},
			body: JSON.stringify({ expectedRevision }),
		},
	);
}

export async function regenerateCandidates(
	projectId: string,
	expectedRevision: number,
): Promise<{ jobId?: string; status: string }> {
	return queuedJobSchema.parse(
		await json(
			`/clipping/projects/${encodeURIComponent(projectId)}/candidates/regenerate`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": key("candidate-regenerate"),
				},
				body: JSON.stringify({ expectedRevision }),
			},
		),
	);
}

export async function getProjectJob(
	projectId: string,
	jobId: string,
): Promise<{
	status: string;
	progress: number;
	current_stage: string | null;
	output?: { projectRevision?: number };
	failure_message?: string | null;
}> {
	return projectJobSchema.parse(
		await json(
			`/clipping/projects/${encodeURIComponent(projectId)}/jobs/${encodeURIComponent(jobId)}`,
		),
	);
}

export async function getProjectStatus(
	projectId: string,
): Promise<Record<string, unknown>> {
	return unknownRecordSchema.parse(
		await json(`/clipping/projects/${encodeURIComponent(projectId)}/status`),
	);
}

export async function requestConversion(
	projectId: string,
	revision: number,
	targetProjectId: string,
): Promise<{ jobId: string }> {
	return conversionResultSchema.parse(
		await json(
			`/clipping/projects/${encodeURIComponent(projectId)}/conversion`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": key("conversion"),
				},
				body: JSON.stringify({
					expectedRevision: revision,
					targetProjectId,
					includeCaptions: true,
				}),
			},
		),
	);
}

export async function preparePreview(
	projectId: string,
	revision: number,
): Promise<Record<string, unknown>> {
	return unknownRecordSchema.parse(
		await json(`/clipping/projects/${encodeURIComponent(projectId)}/preview`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": key("preview"),
			},
			body: JSON.stringify({ expectedRevision: revision }),
		}),
	);
}

export async function createExport(
	projectId: string,
	revision: number,
): Promise<{ exportId: string; status: string }> {
	return exportResultSchema.parse(
		await json(`/clipping/projects/${encodeURIComponent(projectId)}/exports`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": key("export"),
			},
			body: JSON.stringify({
				schemaVersion: 1,
				expectedProjectRevision: revision,
				preset: "vertical-mp4-v1",
				options: { includeCaptions: true },
			}),
		}),
	);
}

export async function getExport(
	exportId: string,
): Promise<Record<string, unknown>> {
	return unknownRecordSchema.parse(
		await json(`/clipping/exports/${encodeURIComponent(exportId)}`),
	);
}

export function cancelExport(exportId: string): Promise<unknown> {
	return json(`/clipping/exports/${encodeURIComponent(exportId)}/cancel`, {
		method: "POST",
	});
}

export async function getExportDownload(exportId: string): Promise<string> {
	const result = downloadResultSchema.parse(
		await json(`/clipping/exports/${encodeURIComponent(exportId)}/download`),
	);
	return result.url;
}

export async function prepareHandoff(
	projectId: string,
	revision: number,
	targetProjectId: string,
): Promise<{ handoffId: string }> {
	return handoffResultSchema.parse(
		await json(`/clipping/projects/${encodeURIComponent(projectId)}/handoff`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": key("handoff"),
			},
			body: JSON.stringify({
				expectedRevision: revision,
				targetProjectId,
				options: { includeCaptions: true },
			}),
		}),
	);
}
