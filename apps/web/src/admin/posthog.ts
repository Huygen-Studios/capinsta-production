import "server-only";

import { webEnv } from "@/env/web";

type PostHogQueryResponse = {
	results?: unknown;
};

function firstNumericResult(payload: PostHogQueryResponse): number | null {
	const first = Array.isArray(payload.results) ? payload.results[0] : null;
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
		},
	);

	if (!response.ok) {
		throw new Error(`posthog_query_failed_${response.status}`);
	}

	const payload = (await response.json()) as PostHogQueryResponse;
	return firstNumericResult(payload);
}
