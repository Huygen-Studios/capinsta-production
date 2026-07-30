import { authenticatedFetch } from "@/lib/supabase/authenticated-fetch";
import { buildCapinstaApiUrl } from "./api-url";
import { getCapinstaMediaUploadBaseUrl } from "./featureFlags";

function endpoint(path: string): string {
	return buildCapinstaApiUrl({ baseUrl: getCapinstaMediaUploadBaseUrl(), path });
}

const MEDIA_UPLOAD_CHUNK_BYTES = 5 * 1024 * 1024;

function readStringField({
	value,
	field,
}: {
	value: unknown;
	field: string;
}): string | undefined {
	if (typeof value !== "object" || value === null || !(field in value)) {
		return undefined;
	}
	const fieldValue = Reflect.get(value, field);
	return typeof fieldValue === "string" ? fieldValue : undefined;
}

export class MediaUploadError extends Error {
	public readonly status: number;
	public readonly code?: string;
	public readonly correlationId?: string | null;
	public readonly responseBody?: unknown;

	constructor({
		message,
		status,
		code,
		correlationId,
		responseBody,
	}: {
		message: string;
		status: number;
		code?: string;
		correlationId?: string | null;
		responseBody?: unknown;
	}) {
		super(message);
		this.name = "MediaUploadError";
		this.status = status;
		this.code = code;
		this.correlationId = correlationId;
		this.responseBody = responseBody;
	}
}

export function messageForMediaFailure({
	status,
	code,
	fallback,
}: {
	status: number;
	code?: string;
	fallback: string;
}) {
	if (code === "caption_duration_limit_exceeded") {
		return (
			fallback || "This video exceeds your current caption duration limit."
		);
	}
	if (code === "media_duration_exceeded") {
		return fallback || "This media exceeds the technical duration limit.";
	}
	if (code === "invalid_media_metadata") {
		return fallback || "The media duration could not be determined.";
	}
	if (code === "media_dimensions_limit") {
		return fallback || "This media exceeds the supported dimensions.";
	}
	if (code === "upload_too_large") {
		return fallback || "This file exceeds the current upload-size limit.";
	}
	if (fallback && fallback !== "Media upload failed.") return fallback;
	if (status === 400) return "The project or file upload request is invalid.";
	if (status === 401) return "Your session expired. Please sign in again.";
	if (status === 403)
		return "Your account does not currently have editor access.";
	if (status === 413)
		return "This request exceeds the configured upload limit.";
	if (status === 415) return "Upload a supported video file.";
	if (status === 422)
		return "The media upload request is missing required fields.";
	if (status === 429) return "Too many uploads. Please try again shortly.";
	if (status === 503 || code === "backend_unreachable") {
		return (
			fallback ||
			"The processing API is unavailable before the upload could begin."
		);
	}
	if (status >= 500) return "The media service could not save this file.";
	return fallback || "Media upload failed.";
}

async function readError({
	response,
	context,
}: {
	response: Response;
	context?: {
		endpoint: string;
		projectId?: string;
		filename?: string;
		mimeType?: string;
		size?: number;
		fileAttached: boolean;
	};
}): Promise<MediaUploadError> {
	const body: unknown = await response.json().catch(() => null);
	let code: string | undefined;
	let correlationId: string | null | undefined;
	let fallback = response.statusText || "Media upload failed.";
	if (typeof body === "object" && body !== null && "detail" in body) {
		const detail = body.detail;
		if (typeof detail === "string") fallback = detail;
		const detailMessage =
			readStringField({ value: detail, field: "message" }) ??
			readStringField({ value: detail, field: "error" }) ??
			readStringField({ value: detail, field: "detail" });
		if (detailMessage) fallback = detailMessage;
		code = readStringField({ value: detail, field: "code" }) ?? code;
		correlationId =
			readStringField({ value: detail, field: "diagnosticId" }) ??
			readStringField({ value: detail, field: "correlationId" }) ??
			correlationId;
	}
	if (typeof body === "object" && body !== null) {
		const envelope = Reflect.get(body, "error");
		const envelopeMessage = readStringField({
			value: envelope,
			field: "message",
		});
		if (envelopeMessage) fallback = envelopeMessage;
		code = readStringField({ value: envelope, field: "code" }) ?? code;
		correlationId =
			readStringField({ value: envelope, field: "requestId" }) ??
			readStringField({ value: envelope, field: "correlationId" }) ??
			correlationId;
		if ("code" in body && typeof body.code === "string") code = body.code;
		if ("correlationId" in body && typeof body.correlationId === "string") {
			correlationId = body.correlationId;
		}
	}
	const message = messageForMediaFailure({
		status: response.status,
		code,
		fallback,
	});
	console.warn("[Capinsta media] Upload request failed", {
		...context,
		status: response.status,
		statusText: response.statusText,
		code,
		correlationId,
		responseBody: body,
	});
	return new MediaUploadError({
		message,
		status: response.status,
		code,
		correlationId,
		responseBody: body,
	});
}

export async function uploadProjectMediaAsset({
	projectId,
	file,
	signal,
}: {
	projectId: string;
	file: File;
	signal?: AbortSignal;
}): Promise<{
	assetId: string;
	downloadUrl: string;
	sizeBytes: number;
}> {
	if (file.size > MEDIA_UPLOAD_CHUNK_BYTES) {
		return uploadProjectMediaAssetInChunks({ projectId, file, signal });
	}
	const formData = new FormData();
	formData.append("project_id", projectId);
	formData.append("file", file);
	const uploadEndpoint = endpoint("/media/assets");
	let response: Response;
	try {
		response = await authenticatedFetch(uploadEndpoint, {
			method: "POST",
			body: formData,
			signal,
		});
	} catch (error) {
		console.warn("[Capinsta media] Upload request threw before response", {
			endpoint: uploadEndpoint,
			projectId,
			fileAttached: true,
			filename: file.name,
			mimeType: file.type,
			size: file.size,
			error,
		});
		if (signal?.aborted) throw error;
		throw new MediaUploadError({
			message: "The video-processing service is temporarily unavailable.",
			status: 0,
			code: "network_error",
		});
	}
	if (!response.ok) {
		throw await readError({
			response,
			context: {
				endpoint: uploadEndpoint,
				projectId,
				fileAttached: true,
				filename: file.name,
				mimeType: file.type,
				size: file.size,
			},
		});
	}
	const body: unknown = await response.json();
	const assetId = readStringField({ value: body, field: "assetId" });
	if (!assetId) {
		throw new MediaUploadError({
			message:
				"The media service did not return a valid media asset ID. Please retry.",
			status: 502,
			code: "media_asset_id_missing",
		});
	}
	const sizeBytesValue =
		typeof body === "object" && body !== null
			? Reflect.get(body, "sizeBytes")
			: undefined;
	return {
		assetId,
		downloadUrl: readStringField({ value: body, field: "downloadUrl" }) ?? "",
		sizeBytes: typeof sizeBytesValue === "number" ? sizeBytesValue : 0,
	};
}

async function uploadProjectMediaAssetInChunks({
	projectId,
	file,
	signal,
}: {
	projectId: string;
	file: File;
	signal?: AbortSignal;
}): Promise<{
	assetId: string;
	downloadUrl: string;
	sizeBytes: number;
}> {
	const initForm = new FormData();
	initForm.append("project_id", projectId);
	initForm.append("file_name", file.name);
	initForm.append("mime_type", file.type || "application/octet-stream");
	initForm.append("size_bytes", file.size.toString());
	const initEndpoint = endpoint("/media/assets/chunked");
	let initResponse: Response;
	try {
		initResponse = await authenticatedFetch(initEndpoint, {
			method: "POST",
			body: initForm,
			signal,
		});
	} catch (error) {
		if (error instanceof TypeError) {
			throw new MediaUploadError({
				message:
					"The processing API is unavailable before the upload could begin. The media-upload service could not be reached from this site. An administrator must check the API health and CORS configuration.",
				status: 503,
				code: "media_service_unreachable",
			});
		}
		throw error;
	}
	if (!initResponse.ok) {
		throw await readError({
			response: initResponse,
			context: {
				endpoint: initEndpoint,
				projectId,
				fileAttached: false,
				filename: file.name,
				mimeType: file.type,
				size: file.size,
			},
		});
	}
	const initBody: unknown = await initResponse.json();
	const uploadId = readStringField({ value: initBody, field: "uploadId" });
	if (!uploadId) {
		throw new MediaUploadError({
			message: "The media service did not start the upload. Please retry.",
			status: 502,
			code: "media_upload_session_missing",
		});
	}

	let offset = 0;
	while (offset < file.size) {
		const chunk = file.slice(
			offset,
			Math.min(offset + MEDIA_UPLOAD_CHUNK_BYTES, file.size),
		);
		const chunkEndpoint = endpoint(
			`/media/assets/chunked/${encodeURIComponent(uploadId)}`,
		);
		let chunkResponse: Response;
		try {
			chunkResponse = await authenticatedFetch(chunkEndpoint, {
				method: "PUT",
				body: chunk,
				headers: {
					"Content-Type": "application/octet-stream",
					"X-Upload-Offset": offset.toString(),
				},
				signal,
			});
		} catch (error) {
			if (error instanceof TypeError) {
				throw new MediaUploadError({
					message:
						"The media chunk upload was interrupted. Check your network connection and retry.",
					status: 503,
					code: "media_chunk_upload_interrupted",
				});
			}
			throw error;
		}
		if (!chunkResponse.ok) {
			throw await readError({
				response: chunkResponse,
				context: {
					endpoint: chunkEndpoint,
					projectId,
					fileAttached: true,
					filename: file.name,
					mimeType: file.type,
					size: chunk.size,
				},
			});
		}
		offset += chunk.size;
	}

	const completeEndpoint = endpoint(
		`/media/assets/chunked/${encodeURIComponent(uploadId)}/complete`,
	);
	let completeResponse: Response;
	try {
		completeResponse = await authenticatedFetch(completeEndpoint, {
			method: "POST",
			signal,
		});
	} catch (error) {
		if (error instanceof TypeError) {
			throw new MediaUploadError({
				message:
					"The processing API could not finalize the media upload. Please retry.",
				status: 503,
				code: "media_completion_failed",
			});
		}
		throw error;
	}
	if (!completeResponse.ok) {
		throw await readError({ response: completeResponse });
	}
	const body: unknown = await completeResponse.json();
	const assetId = readStringField({ value: body, field: "assetId" });
	if (!assetId) {
		throw new MediaUploadError({
			message:
				"The media service did not return a valid media asset ID. Please retry.",
			status: 502,
			code: "media_asset_id_missing",
		});
	}
	const sizeBytesValue =
		typeof body === "object" && body !== null
			? Reflect.get(body, "sizeBytes")
			: undefined;
	return {
		assetId,
		downloadUrl: readStringField({ value: body, field: "downloadUrl" }) ?? "",
		sizeBytes: typeof sizeBytesValue === "number" ? sizeBytesValue : file.size,
	};
}

export async function fetchProjectMediaAsset({
	assetId,
}: {
	assetId: string;
}): Promise<Blob> {
	const response = await authenticatedFetch(
		endpoint(`/media/assets/${encodeURIComponent(assetId)}/content`),
	);
	if (!response.ok) throw await readError({ response });
	return response.blob();
}

export async function verifyProjectMediaAsset({
	assetId,
}: {
	assetId: string;
}): Promise<boolean> {
	const response = await authenticatedFetch(
		endpoint(`/media/assets/${encodeURIComponent(assetId)}/content`),
		{
			method: "HEAD",
			cache: "no-store",
		},
	);
	return response.ok;
}

export async function deleteProjectMediaAsset({
	assetId,
}: {
	assetId: string;
}): Promise<void> {
	const response = await authenticatedFetch(
		endpoint(`/media/assets/${encodeURIComponent(assetId)}`),
		{ method: "DELETE" },
	);
	if (!response.ok && response.status !== 404) {
		throw await readError({ response });
	}
}
