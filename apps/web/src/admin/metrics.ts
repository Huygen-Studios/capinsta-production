import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
	ADMIN_METRICS_QUERY_VERSION,
	getAdminMetricsRange,
	resolveAdminMetric,
	type AdminMetricsRangePreset,
	type AdminMetricsResponse,
	type MetricQuery,
} from "./metrics-shared";
export { normalizeAdminMetricsRangePreset } from "./metrics-shared";

async function countSql(query: ReturnType<typeof sql>): Promise<number | null> {
	const [row] = await db.execute(query);
	const value = row?.value;
	if (value === null || value === undefined) return null;
	return Number(value);
}

function rangeParams(range: { startUtc: string; endUtc: string }) {
	return {
		start: new Date(range.startUtc),
		end: new Date(range.endUtc),
	};
}

export async function getAdminMetrics({
	preset,
	now = new Date(),
}: {
	preset: AdminMetricsRangePreset;
	now?: Date;
}): Promise<AdminMetricsResponse> {
	const range = getAdminMetricsRange({ preset, now });
	const { start, end } = rangeParams(range);
	const generatedAt = now.toISOString();
	const metricSpecs: Array<{
		name: string;
		source: string;
		definition: string;
		query: MetricQuery;
	}> = [
		{
			name: "websiteVisitors",
			source: "PostHog",
			definition: "Website visitors for the selected period. Disabled until PostHog is configured.",
			query: async () => {
				throw new Error("posthog_not_configured");
			},
		},
		{
			name: "newAccounts",
			source: "auth.users.created_at",
			definition:
				"Registered Supabase Auth users created within the selected UTC range, using inclusive start and exclusive end.",
			query: () =>
				countSql(sql`
					select count(*)::int as value
					from auth.users
					where created_at >= ${start}
						and created_at < ${end}
				`),
		},
		{
			name: "totalAccounts",
			source: "auth.users",
			definition: "All registered Supabase Auth users currently present.",
			query: () =>
				countSql(sql`
					select count(*)::int as value
					from auth.users
				`),
		},
		{
			name: "activeAccessUsers",
			source: "app_product_entitlements",
			definition:
				"Distinct users with a granted active CapInsta product entitlement that is not expired.",
			query: () =>
				countSql(sql`
					select count(distinct user_id)::int as value
					from app_product_entitlements
					where status in ('granted','active','approved')
						and (expires_at is null or expires_at > now())
				`),
		},
		{
			name: "activeCreators",
			source: "project_registry, caption_jobs, export_jobs, product_events",
			definition:
				"Distinct authenticated users who created a project, uploaded media, started/completed captions, or completed exports in the selected UTC range.",
			query: () =>
				countSql(sql`
					select count(distinct user_id)::int as value
					from (
						select user_id from project_registry where created_at >= ${start} and created_at < ${end}
						union all
						select user_id from caption_jobs where created_at >= ${start} and created_at < ${end}
						union all
						select user_id from export_jobs where created_at >= ${start} and created_at < ${end}
						union all
						select user_id from product_events
						where occurred_at >= ${start}
							and occurred_at < ${end}
							and event_name in ('media_upload_completed','caption_job_started','caption_job_completed','export_completed')
					) events
					where user_id is not null
				`),
		},
		{
			name: "projectsCreated",
			source: "project_registry.created_at",
			definition: "Projects created in the selected UTC range.",
			query: () =>
				countSql(sql`
					select count(*)::int as value
					from project_registry
					where created_at >= ${start}
						and created_at < ${end}
				`),
		},
		{
			name: "uploadsCompleted",
			source: "product_events",
			definition: "Server-recorded completed media upload events in the selected UTC range.",
			query: () =>
				countSql(sql`
					select count(*)::int as value
					from product_events
					where event_name = 'media_upload_completed'
						and occurred_at >= ${start}
						and occurred_at < ${end}
				`),
		},
		{
			name: "uploadsFailed",
			source: "product_events",
			definition: "Server-recorded failed media upload events in the selected UTC range.",
			query: () =>
				countSql(sql`
					select count(*)::int as value
					from product_events
					where event_name = 'media_upload_failed'
						and occurred_at >= ${start}
						and occurred_at < ${end}
				`),
		},
		{
			name: "captionJobsStarted",
			source: "caption_jobs.created_at",
			definition: "Caption jobs created in the selected UTC range.",
			query: () =>
				countSql(sql`
					select count(*)::int as value
					from caption_jobs
					where created_at >= ${start}
						and created_at < ${end}
				`),
		},
		{
			name: "captionJobsCompleted",
			source: "caption_jobs.completed_at",
			definition: "Caption jobs completed successfully in the selected UTC range.",
			query: () =>
				countSql(sql`
					select count(*)::int as value
					from caption_jobs
					where status in ('completed','succeeded')
						and completed_at >= ${start}
						and completed_at < ${end}
				`),
		},
		{
			name: "captionJobsFailed",
			source: "caption_jobs.created_at/status",
			definition: "Caption jobs marked failed in the selected UTC range.",
			query: () =>
				countSql(sql`
					select count(*)::int as value
					from caption_jobs
					where status = 'failed'
						and created_at >= ${start}
						and created_at < ${end}
				`),
		},
		{
			name: "exportsStarted",
			source: "export_jobs.created_at",
			definition: "Export jobs created in the selected UTC range.",
			query: () =>
				countSql(sql`
					select count(*)::int as value
					from export_jobs
					where created_at >= ${start}
						and created_at < ${end}
				`),
		},
		{
			name: "exportsCompleted",
			source: "export_jobs.completed_at",
			definition: "Export jobs completed successfully in the selected UTC range.",
			query: () =>
				countSql(sql`
					select count(*)::int as value
					from export_jobs
					where status in ('completed','succeeded')
						and completed_at >= ${start}
						and completed_at < ${end}
				`),
		},
		{
			name: "exportsFailed",
			source: "export_jobs.created_at/status",
			definition: "Export jobs marked failed in the selected UTC range.",
			query: () =>
				countSql(sql`
					select count(*)::int as value
					from export_jobs
					where status = 'failed'
						and created_at >= ${start}
						and created_at < ${end}
				`),
		},
		{
			name: "medianCaptionDurationSeconds",
			source: "caption_jobs.started_at/completed_at",
			definition: "Median seconds between caption job start and completion in the selected UTC range.",
			query: () =>
				countSql(sql`
					select percentile_cont(0.5) within group (
						order by extract(epoch from (completed_at - started_at))
					)::int as value
					from caption_jobs
					where started_at is not null
						and completed_at is not null
						and completed_at >= ${start}
						and completed_at < ${end}
						and status in ('completed','succeeded')
				`),
		},
		{
			name: "medianExportDurationSeconds",
			source: "export_jobs.started_at/completed_at",
			definition: "Median seconds between export start and completion in the selected UTC range.",
			query: () =>
				countSql(sql`
					select percentile_cont(0.5) within group (
						order by extract(epoch from (completed_at - started_at))
					)::int as value
					from export_jobs
					where started_at is not null
						and completed_at is not null
						and completed_at >= ${start}
						and completed_at < ${end}
						and status in ('completed','succeeded')
				`),
		},
		{
			name: "waitlistCount",
			source: "profiles.product_access_status",
			definition: "Profiles currently waiting for product access.",
			query: () =>
				countSql(sql`
					select count(*)::int as value
					from profiles
					where product_access_status in ('pending','waitlist','requested')
				`),
		},
		{
			name: "privateServerRequests",
			source: "private_server_requests.created_at",
			definition: "Private Server contact requests submitted in the selected UTC range.",
			query: () =>
				countSql(sql`
					select count(*)::int as value
					from private_server_requests
					where created_at >= ${start}
						and created_at < ${end}
				`),
		},
		{
			name: "successfulDonations",
			source: "donations.verified_at/status",
			definition: "Verified paid donation records in the selected UTC range.",
			query: () =>
				countSql(sql`
					select count(*)::int as value
					from donations
					where status = 'paid'
						and verified_at >= ${start}
						and verified_at < ${end}
				`),
		},
		{
			name: "failedDonations",
			source: "donations.updated_at/status",
			definition: "Donation records marked failed in the selected UTC range.",
			query: () =>
				countSql(sql`
					select count(*)::int as value
					from donations
					where status = 'failed'
						and updated_at >= ${start}
						and updated_at < ${end}
				`),
		},
		{
			name: "refundedDonations",
			source: "donations.updated_at/status",
			definition: "Donation records marked refunded in the selected UTC range.",
			query: () =>
				countSql(sql`
					select count(*)::int as value
					from donations
					where status = 'refunded'
						and updated_at >= ${start}
						and updated_at < ${end}
				`),
		},
		{
			name: "donationTotalInr",
			source: "donations.amount_inr/status",
			definition: "Total INR from verified paid donations in the selected UTC range.",
			query: () =>
				countSql(sql`
					select coalesce(sum(amount_inr), 0)::int as value
					from donations
					where status = 'paid'
						and verified_at >= ${start}
						and verified_at < ${end}
				`),
		},
		{
			name: "captionFailureRate",
			source: "caption_jobs.status",
			definition: "Failed caption jobs divided by all caption jobs created in the selected UTC range, as a percentage.",
			query: () =>
				countSql(sql`
					select coalesce(
						round(
							100.0 * count(*) filter (where status = 'failed') / nullif(count(*), 0)
						),
						0
					)::int as value
					from caption_jobs
					where created_at >= ${start}
						and created_at < ${end}
				`),
		},
		{
			name: "exportFailureRate",
			source: "export_jobs.status",
			definition: "Failed export jobs divided by all export jobs created in the selected UTC range, as a percentage.",
			query: () =>
				countSql(sql`
					select coalesce(
						round(
							100.0 * count(*) filter (where status = 'failed') / nullif(count(*), 0)
						),
						0
					)::int as value
					from export_jobs
					where created_at >= ${start}
						and created_at < ${end}
				`),
		},
		{
			name: "lastSuccessfulCaptionJob",
			source: "caption_jobs.completed_at",
			definition: "Age in minutes of the most recent successful caption job, or unavailable when none exists.",
			query: () =>
				countSql(sql`
					select extract(epoch from (now() - max(completed_at)))::int / 60 as value
					from caption_jobs
					where status in ('completed','succeeded')
				`),
		},
		{
			name: "lastSuccessfulExport",
			source: "export_jobs.completed_at",
			definition: "Age in minutes of the most recent successful export, or unavailable when none exists.",
			query: () =>
				countSql(sql`
					select extract(epoch from (now() - max(completed_at)))::int / 60 as value
					from export_jobs
					where status in ('completed','succeeded')
				`),
		},
	];

	const resolved = await Promise.all(
		metricSpecs.map((spec) => resolveAdminMetric({ ...spec, now })),
	);
	return {
		generatedAt,
		range,
		queryVersion: ADMIN_METRICS_QUERY_VERSION,
		metrics: Object.fromEntries(
			resolved.map((item) => [item.name, item.metric]),
		),
		errors: resolved.flatMap((item) => (item.error ? [item.error] : [])),
	};
}
