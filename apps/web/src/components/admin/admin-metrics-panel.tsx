"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
	AdminMetric,
	AdminMetricsRangePreset,
	AdminMetricsResponse,
} from "@/admin/metrics-shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const GROUPS = [
	{
		title: "Acquisition",
		metrics: ["websiteVisitors", "newAccounts", "totalAccounts"],
	},
	{
		title: "Product usage",
		metrics: [
			"activeCreators",
			"projectsCreated",
			"uploadsCompleted",
			"uploadsFailed",
			"captionJobsStarted",
			"captionJobsCompleted",
			"captionJobsFailed",
			"exportsStarted",
			"exportsCompleted",
			"exportsFailed",
			"medianCaptionDurationSeconds",
			"medianExportDurationSeconds",
		],
	},
	{
		title: "Business",
		metrics: [
			"activeAccessUsers",
			"waitlistCount",
			"privateServerRequests",
			"successfulDonations",
			"failedDonations",
			"refundedDonations",
			"donationTotalInr",
		],
	},
	{
		title: "Reliability",
		metrics: [
			"lastSuccessfulCaptionJob",
			"lastSuccessfulExport",
			"captionFailureRate",
			"exportFailureRate",
		],
	},
] as const;

const LABELS: Record<string, string> = {
	activeAccessUsers: "Users with active access",
	activeCreators: "Active creators",
	captionFailureRate: "Caption failure rate",
	captionJobsCompleted: "Caption jobs completed",
	captionJobsFailed: "Caption jobs failed",
	captionJobsStarted: "Caption jobs started",
	donationTotalInr: "Donation total",
	exportsCompleted: "Exports completed",
	exportsFailed: "Exports failed",
	exportsStarted: "Exports started",
	failedDonations: "Failed donations",
	lastSuccessfulCaptionJob: "Last successful caption job",
	lastSuccessfulExport: "Last successful export",
	medianCaptionDurationSeconds: "Median caption duration",
	medianExportDurationSeconds: "Median export duration",
	newAccounts: "New accounts",
	privateServerRequests: "Private Server requests",
	projectsCreated: "Projects created",
	refundedDonations: "Refunds",
	successfulDonations: "Successful donations",
	totalAccounts: "Total accounts",
	uploadsCompleted: "Uploads completed",
	uploadsFailed: "Uploads failed",
	waitlistCount: "Waitlist",
	websiteVisitors: "Website visitors",
};

function valueFor({ name, metric }: { name: string; metric: AdminMetric }) {
	if (metric.status !== "ok") return "Unavailable";
	if (metric.value === null) return name.startsWith("lastSuccessful") ? "Never" : "0";
	if (name.endsWith("Rate")) return `${metric.value}%`;
	if (name.startsWith("median")) return `${metric.value}s`;
	if (name.startsWith("lastSuccessful")) return formatAge(metric.value);
	if (name === "donationTotalInr") return `₹${metric.value.toLocaleString("en-IN")}`;
	return metric.value.toLocaleString("en-IN");
}

function formatAge(minutes: number) {
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	return days ? `${days}d ${hours % 24}h ago` : `${hours}h ${minutes % 60}m ago`;
}

function isAdminMetricsResponse(value: unknown): value is AdminMetricsResponse {
	if (!value || typeof value !== "object") return false;
	return (
		"generatedAt" in value &&
		"range" in value &&
		"metrics" in value &&
		"errors" in value
	);
}

function MetricCard({
	name,
	metric,
	rangeLabel,
}: {
	name: string;
	metric: AdminMetric;
	rangeLabel: string;
}) {
	const unhealthy = metric.status !== "ok";
	return (
		<Card className={unhealthy ? "border-caution" : "border-2"}>
			<CardHeader>
				<div className="flex items-start justify-between gap-3">
					<div>
						<CardDescription>{LABELS[name] ?? name}</CardDescription>
						<CardTitle className="mt-1 font-display text-2xl">
							{valueFor({ name, metric })}
						</CardTitle>
					</div>
					<Badge
						variant="outline"
						className={unhealthy ? "border-caution text-caution" : undefined}
					>
						{metric.status}
					</Badge>
				</div>
			</CardHeader>
			<CardContent className="space-y-2 text-xs text-muted-foreground">
				<p>
					<span className="font-semibold text-foreground">Source:</span>{" "}
					{metric.source}
				</p>
				<p>
					<span className="font-semibold text-foreground">Range:</span>{" "}
					{rangeLabel}
				</p>
				<p>{metric.definition}</p>
				<p>Updated {new Date(metric.updatedAt).toLocaleString()}</p>
			</CardContent>
		</Card>
	);
}

function LoadingGrid() {
	return (
		<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
			{Array.from({ length: 8 }, (_, index) => (
				<Card key={index} className="border-2">
					<CardHeader>
						<Skeleton className="h-4 w-24" />
						<Skeleton className="h-9 w-32" />
					</CardHeader>
					<CardContent className="space-y-2">
						<Skeleton className="h-3 w-full" />
						<Skeleton className="h-3 w-4/5" />
					</CardContent>
				</Card>
			))}
		</div>
	);
}

export function AdminMetricsPanel() {
	const [range, setRange] = useState<AdminMetricsRangePreset>("7d");
	const [data, setData] = useState<AdminMetricsResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(0);

	const refresh = useCallback(async ({ signal }: { signal?: AbortSignal } = {}) => {
		setLoading(true);
		setError(null);
		try {
			const response = await fetch(`/api/admin/metrics?range=${range}`, {
				cache: "no-store",
				signal,
			});
			if (!response.ok) throw new Error(`metrics_${response.status}`);
			const payload: unknown = await response.json();
			if (!isAdminMetricsResponse(payload)) throw new Error("invalid_metrics_payload");
			setData(payload);
		} catch {
			if (signal?.aborted) return;
			setError("Admin metrics are unavailable. Retry after checking server logs.");
		} finally {
			if (!signal?.aborted) setLoading(false);
		}
	}, [range]);

	useEffect(() => {
		if (!autoRefreshSeconds) return;
		const timer = window.setInterval(() => {
			if (document.visibilityState === "visible") void refresh();
		}, autoRefreshSeconds * 1000);
		return () => window.clearInterval(timer);
	}, [autoRefreshSeconds, refresh]);

	useEffect(() => {
		const controller = new AbortController();
		void (async () => {
			try {
				const response = await fetch(`/api/admin/metrics?range=${range}`, {
					cache: "no-store",
					signal: controller.signal,
				});
				if (!response.ok) throw new Error(`metrics_${response.status}`);
				const payload: unknown = await response.json();
				if (!isAdminMetricsResponse(payload)) throw new Error("invalid_metrics_payload");
				if (!controller.signal.aborted) {
					setData(payload);
					setError(null);
				}
			} catch {
				if (!controller.signal.aborted) {
					setError("Admin metrics are unavailable. Retry after checking server logs.");
				}
			} finally {
				if (!controller.signal.aborted) setLoading(false);
			}
		})();
		return () => controller.abort();
	}, [range]);

	const groupedMetrics = useMemo(() => data?.metrics ?? {}, [data]);
	const unavailable = useMemo(() => Object.entries(groupedMetrics)
		.filter(([, metric]) => metric.status === "unavailable"), [groupedMetrics]);

	return (
		<section className="space-y-4">
			<div className="sticky top-16 z-10 flex flex-col gap-3 rounded-md border-2 bg-background/95 p-4 backdrop-blur md:flex-row md:items-center md:justify-between">
				<div>
					<h2 className="font-display text-2xl">Admin metrics</h2>
					<p className="text-sm text-muted-foreground">
						{data
							? `${data.range.label} · ${data.range.startUtc} to ${data.range.endUtc} · ${data.range.timezone} · generated ${new Date(data.generatedAt).toLocaleString()}`
							: "Loading authoritative account, product, business, and reliability metrics."}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{(["24h", "7d", "30d"] as const).map((option) => (
						<Button
							key={option}
							variant={range === option ? "default" : "outline"}
							size="sm"
							onClick={() => {
								setData(null);
								setLoading(true);
								setRange(option);
							}}
						>
							{option}
						</Button>
					))}
					<label className="flex items-center gap-2 text-xs font-semibold">
						Auto refresh
						<select className="h-8 rounded-sm border-2 bg-background px-2" value={autoRefreshSeconds}
							onChange={(event) => setAutoRefreshSeconds(Number(event.target.value))}>
							<option value={0}>Off</option><option value={30}>30 seconds</option>
							<option value={60}>60 seconds</option><option value={300}>5 minutes</option>
						</select>
					</label>
					<Button variant="background" size="sm" disabled={loading} onClick={() => void refresh()}>
						<RefreshCw className={loading ? "animate-spin" : undefined} aria-hidden="true" />
						{loading ? "Refreshing…" : "Refresh"}
					</Button>
				</div>
			</div>
			{error ? (
				<Alert className="border-destructive">
					<AlertTriangle aria-hidden="true" />
					<AlertTitle>Metrics request failed</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			) : null}
			{unavailable.length ? (
				<Alert className="border-caution">
					<AlertTriangle aria-hidden="true" />
					<AlertTitle>Some metric sources are unavailable</AlertTitle>
					<AlertDescription>
						{unavailable.length} unavailable metric{unavailable.length === 1 ? "" : "s"} grouped here; healthy metrics remain prominent.
						<details className="mt-2"><summary className="cursor-pointer font-semibold">View diagnostics</summary>
							<ul className="mt-2 list-disc pl-5">{unavailable.map(([name, metric]) => <li key={name}>{LABELS[name] ?? name}: {metric.errorCode} · {metric.adminMessage}</li>)}</ul>
						</details>
					</AlertDescription>
				</Alert>
			) : null}
			{loading && !data ? <LoadingGrid /> : null}
			{data ? (
				<div className="space-y-6">
					{GROUPS.map((group) => (
						<div key={group.title} className="space-y-3">
							<h3 className="font-display text-xl">{group.title}</h3>
							<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
								{group.metrics.map((name) => {
									const metric = groupedMetrics[name];
									return metric ? (
										metric.status === "unavailable" ? null :
										<MetricCard
											key={name}
											name={name}
											metric={metric}
											rangeLabel={data.range.label}
										/>
									) : null;
								})}
							</div>
						</div>
					))}
					{data.sourceHealth.length ? <Card className="border-2"><CardHeader><CardTitle>Data source health</CardTitle><CardDescription>Safe server-side diagnostics; credentials and personal data are never included.</CardDescription></CardHeader><CardContent className="space-y-2">{data.sourceHealth.map((source) => <details key={source.source} className="rounded-sm border p-3"><summary className="flex cursor-pointer items-center justify-between font-semibold"><span>{source.source}</span><Badge variant="outline">{source.status}</Badge></summary><div className="mt-2 grid gap-1 text-xs text-muted-foreground"><p>Configuration: {source.configuration}</p><p>Last success: {source.lastSuccess ? new Date(source.lastSuccess).toLocaleString() : "Never"}</p><p>Last error: {source.lastErrorSummary ?? "None"}</p></div></details>)}</CardContent></Card> : null}
				</div>
			) : null}
		</section>
	);
}
