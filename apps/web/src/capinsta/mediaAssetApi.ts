import { authenticatedFetch } from "@/lib/supabase/authenticated-fetch";
import { authenticatedFetch } from "@/lib/supabase/authenticated-fetch";
import { buildCapinstaApiUrl } from "./api-url";
import { getCapinstaApiBaseUrl } from "./featureFlags";

function endpoint(path: string): string {
	return buildCapinstaApiUrl({ baseUrl: getCapinstaApiBaseUrl(), path });
}

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

	constructor({
		message,
		status,
		code,
		correlationId,
	}: {
		message: string;
		status: number;
		code?: string;
		correlationId?: string | null;
	}) {
		super(message);
		this.name = "MediaUploadError";
		this.status = status;
		this.code = code;
		this.correlationId = correlationId;
	}
}

function messageForMediaFailure({
	status,
	code,
	fallback,
}: {
	status: number;
	code?: string;
	fallback: string;
}) {
	if (status === 400) return "The project or file upload request is invalid.";
	if (status === 401) return "Your session expired. Please sign in again.";
	if (status === 403) return "Your account does not currently have editor access.";
	if (status === 413) return "This file exceeds the upload limit.";
	if (status === 429) return "Too many uploads. Please try again shortly.";
	if (status === 503 || code === "backend_unreachable") {
		return "The media service is temporarily unavailable.";
	}
	if (status >= 500) return "The media service could not save this file.";
	return fallback || "Media upload failed.";
}

async function readError(response: Response): Promise<MediaUploadError> {
	const body: unknown = await response.json().catch(() => null);
	let code: string | undefined;
	let correlationId: string | null | undefined;
	let fallback = response.statusText || "Media upload failed.";
	if (
		typeof body === "object" &&
		body !== null &&
		"detail" in body
	) {
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
		if ("code" in body && typeof body.code === "string") code = body.code;
		if (
			"correlationId" in body &&
			typeof body.correlationId === "string"
		) {
			correlationId = body.correlationId;
		}
	}
	const message = messageForMediaFailure({
		status: response.status,
		code,
		fallback,
	});
	return new MediaUploadError({
		message,
		status: response.status,
		code,
		correlationId,
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
	const formData = new FormData();
	formData.append("project_id", projectId);
	formData.append("file", file);
	const response = await authenticatedFetch(endpoint("/media/assets"), {
		method: "POST",
		body: formData,
		signal,
	});
	if (!response.ok) throw await readError(response);
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
		downloadUrl:
			readStringField({ value: body, field: "downloadUrl" }) ?? "",
		sizeBytes: typeof sizeBytesValue === "number" ? sizeBytesValue : 0,
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
	if (!response.ok) throw await readError(response);
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
		throw await readError(response);
	}
}
