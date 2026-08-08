import { authenticatedFetch } from "@/lib/supabase/authenticated-fetch";
import { buildCapinstaApiUrl } from "./api-url";
import { getCapinstaApiBaseUrl } from "./featureFlags";

export type ProjectDeletionStatus =
	| "queued"
	| "deleting"
	| "completed"
	| "failed";

type ProjectDeletionResponse = {
	status?: ProjectDeletionStatus;
	errorCode?: string | null;
	detail?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function isProjectDeletionStatus(value: unknown): value is ProjectDeletionStatus {
	return (
		value === "queued" ||
		value === "deleting" ||
		value === "completed" ||
		value === "failed"
	);
}

function parseProjectDeletionResponse(value: unknown): ProjectDeletionResponse | null {
	if (!isRecord(value)) return null;
	return {
		...(isProjectDeletionStatus(value.status) ? { status: value.status } : {}),
		...(typeof value.errorCode === "string" || value.errorCode === null
			? { errorCode: value.errorCode }
			: {}),
		...(typeof value.detail === "string" ? { detail: value.detail } : {}),
	};
}

function endpoint(projectId: string): string {
	return buildCapinstaApiUrl({
		baseUrl: getCapinstaApiBaseUrl(),
		path: `/projects/${encodeURIComponent(projectId)}`,
	});
}

async function readResponse(response: Response) {
	const body = parseProjectDeletionResponse(
		await response.json().catch(() => null),
	);
	if (!response.ok) {
		throw new Error(body?.detail || response.statusText || "Project deletion failed.");
	}
	return body;
}

export async function deleteServerProject({
	projectId,
}: {
	projectId: string;
}): Promise<void> {
	const response = await authenticatedFetch(endpoint(projectId), {
		method: "DELETE",
	});
	const started = await readResponse(response);
	if (started?.status === "completed") return;

	const deadline = Date.now() + 120_000;
	while (Date.now() < deadline) {
		const statusResponse = await authenticatedFetch(
			`${endpoint(projectId)}/deletion`,
			{ cache: "no-store" },
		);
		const status = await readResponse(statusResponse);
		if (status?.status === "completed") return;
		if (status?.status === "failed") {
			throw new Error(
				status.errorCode
					? `Project cleanup failed (${status.errorCode}).`
					: "Project cleanup failed.",
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 750));
	}
	throw new Error("Project deletion is still running. Please retry shortly.");
}
