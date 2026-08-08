import "server-only";

import { webEnv } from "@/env/web";

function firstNumericResult(payload: unknown): number | null {
	if (!payload || typeof payload !== "object" || !("results" in payload)) return null;
	const results = Reflect.get(payload, "results");
	const first = Array.isArray(results) ? results[0] : null;
	if (Array.isArray(first)) {
		const value = first[0];
		return typeof value === "number" && Number.isFinite(value) ? value : null;
	}
	return typeof first === "number" && Number.isFinite(first) ? first : null;
}

export async function queryPostHogWebsiteVisitors({
	startUtc,
	endUtc,
}: {
	startUtc: string;
	endUtc: string;
}): Promise<number | null> {
	if (!webEnv.POSTHOG_PROJECT_ID || !webEnv.POSTHOG_PERSONAL_API_KEY) {
		throw new Error("posthog_not_configured");
	}

	const response = await fetch(
		`${webEnv.POSTHOG_API_HOST.replace(/\/$/, "")}/api/projects/${encodeURIComponent(
			webEnv.POSTHOG_PROJECT_ID,
		)}/query/`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${webEnv.POSTHOG_PERSONAL_API_KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				query: {
					kind: "HogQLQuery",
					query:
						"select count(distinct person_id) from events where event = '$pageview' and timestamp >= $start and timestamp < $end",
					values: {
						start: startUtc,
						end: endUtc,
					},
				},
			}),
			cache: "no-store",
			signal: AbortSignal.timeout(8000),
		},
	);

	if (!response.ok) {
		throw new Error(`posthog_query_failed_${response.status}`);
	}

	const payload: unknown = await response.json();
	const value = firstNumericResult(payload);
	if (value === null) throw new Error("posthog_invalid_response");
	return value;
}
