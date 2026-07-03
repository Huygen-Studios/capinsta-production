export const ADMIN_METRICS_QUERY_VERSION = "admin_metrics_v1";

export type AdminMetricStatus = "ok" | "unavailable" | "partial";
export type AdminMetricsRangePreset = "24h" | "7d" | "30d";

export type AdminMetric = {
	value: number | null;
	status: AdminMetricStatus;
	source: string;
	definition: string;
	updatedAt: string;
	errorCode?: string;
};

export type AdminMetricsResponse = {
	generatedAt: string;
	range: {
		preset: AdminMetricsRangePreset;
		label: string;
		startUtc: string;
		endUtc: string;
		timezone: "UTC";
	};
	queryVersion: typeof ADMIN_METRICS_QUERY_VERSION;
	metrics: Record<string, AdminMetric>;
	errors: Array<{ metric: string; code: string }>;
};

export type MetricQuery = () => Promise<number | null>;

const RANGE_DURATIONS: Record<AdminMetricsRangePreset, number> = {
	"24h": 24 * 60 * 60 * 1000,
	"7d": 7 * 24 * 60 * 60 * 1000,
	"30d": 30 * 24 * 60 * 60 * 1000,
};

const RANGE_LABELS: Record<AdminMetricsRangePreset, string> = {
	"24h": "Rolling last 24 hours",
	"7d": "Rolling last 7 x 24 hours",
	"30d": "Rolling last 30 x 24 hours",
};

export function normalizeAdminMetricsRangePreset({
	value,
}: {
	value: string | null | undefined;
}): AdminMetricsRangePreset {
	if (value === "24h" || value === "7d" || value === "30d") return value;
	return "7d";
}

export function getAdminMetricsRange({
	preset,
	now = new Date(),
}: {
	preset: AdminMetricsRangePreset;
	now?: Date;
}) {
	const end = new Date(now);
	const start = new Date(end.getTime() - RANGE_DURATIONS[preset]);
	return {
		preset,
		label: RANGE_LABELS[preset],
		startUtc: start.toISOString(),
		endUtc: end.toISOString(),
		timezone: "UTC" as const,
	};
}

function metric({
	value,
	source,
	definition,
	status = "ok",
	errorCode,
	now,
}: {
	value: number | null;
	source: string;
	definition: string;
	status?: AdminMetricStatus;
	errorCode?: string;
	now: Date;
}): AdminMetric {
	return {
		value,
		status,
		source,
		definition,
		updatedAt: now.toISOString(),
		errorCode,
	};
}

export async function resolveAdminMetric({
	name,
	source,
	definition,
	query,
	now = new Date(),
}: {
	name: string;
	source: string;
	definition: string;
	query: MetricQuery;
	now?: Date;
}): Promise<{ name: string; metric: AdminMetric; error?: { metric: string; code: string } }> {
	try {
		const value = await query();
		return {
			name,
			metric: metric({ value, source, definition, now }),
		};
	} catch (error) {
		console.error("admin_metric_query_failed", {
			metric: name,
			source,
			errorName: error instanceof Error ? error.name : "UnknownError",
			errorMessage:
				error instanceof Error ? error.message.slice(0, 180) : "Unknown metric failure",
		});
		return {
			name,
			metric: metric({
				value: null,
				status: "unavailable",
				source,
				definition,
				errorCode: "query_failed",
				now,
			}),
			error: { metric: name, code: "query_failed" },
		};
	}
}
