/* eslint-disable opencut/prefer-object-params, @typescript-eslint/no-unsafe-type-assertion -- API errors and validated JSON cross typed runtime boundaries. */
import type { CapinstaProjectHandoffManifestV1 } from "@capinsta/transcript-contract";
import { buildCapinstaApiUrl } from "@/capinsta/api-url";
import { getCapinstaApiBaseUrl } from "@/capinsta/featureFlags";
import { authenticatedFetch } from "@/lib/supabase/authenticated-fetch";

export interface HandoffClaimResponseV1 {
	handoff: CapinstaProjectHandoffManifestV1;
	claim: { status: "claimed" | "imported"; claimedAt: string };
}

export class ClippingHandoffApiError extends Error {
	constructor(
		readonly code: string,
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "ClippingHandoffApiError";
	}
}

function endpoint(path: string): string {
	return buildCapinstaApiUrl({
		baseUrl: getCapinstaApiBaseUrl(),
		path,
	});
}

async function readResponse<T>(response: Response): Promise<T> {
	const body = (await response.json().catch(() => null)) as
		| Record<string, unknown>
		| null;
	if (response.ok) return body as T;
	const detail =
		body && typeof body.detail === "object" && body.detail
			? (body.detail as Record<string, unknown>)
			: body;
	throw new ClippingHandoffApiError(
		typeof detail?.code === "string" ? detail.code : "handoff_unavailable",
		response.status,
		typeof detail?.message === "string"
			? detail.message
			: "The project handoff is unavailable.",
	);
}

export async function claimHandoff({
	handoffId,
}: {
	handoffId: string;
}): Promise<HandoffClaimResponseV1> {
	const response = await authenticatedFetch(
		endpoint(`/clipping/handoffs/${encodeURIComponent(handoffId)}/claim`),
		{ method: "POST", cache: "no-store" },
	);
	return readResponse<HandoffClaimResponseV1>(response);
}

export async function completeHandoff({
	handoffId,
	importedProjectId,
	importedProjectRevision = 1,
}: {
	handoffId: string;
	importedProjectId: string;
	importedProjectRevision?: number;
}): Promise<void> {
	const response = await authenticatedFetch(
		endpoint(`/clipping/handoffs/${encodeURIComponent(handoffId)}/complete`),
		{
			method: "POST",
			cache: "no-store",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ importedProjectId, importedProjectRevision }),
		},
	);
	await readResponse<unknown>(response);
}
