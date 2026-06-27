import { authenticatedFetch } from "@/lib/supabase/authenticated-fetch";
import { buildCapinstaApiUrl } from "./api-url";
import { getCapinstaApiBaseUrl } from "./featureFlags";

function endpoint(path: string): string {
	return buildCapinstaApiUrl({ baseUrl: getCapinstaApiBaseUrl(), path });
}

async function readError(response: Response): Promise<string> {
	const body: unknown = await response.json().catch(() => null);
	if (
		typeof body === "object" &&
		body !== null &&
		"detail" in body
	) {
		const detail = body.detail;
		if (typeof detail === "string") return detail;
		if (
			typeof detail === "object" &&
			detail !== null &&
			"message" in detail &&
			typeof detail.message === "string"
		) {
			return detail.message;
		}
	}
	return response.statusText || "Media request failed.";
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
	if (!response.ok) throw new Error(await readError(response));
	return response.json();
}

export async function fetchProjectMediaAsset({
	assetId,
}: {
	assetId: string;
}): Promise<Blob> {
	const response = await authenticatedFetch(
		endpoint(`/media/assets/${encodeURIComponent(assetId)}/content`),
	);
	if (!response.ok) throw new Error(await readError(response));
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
		throw new Error(await readError(response));
	}
}
