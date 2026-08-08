import { Redis } from "@upstash/redis";
import { sql } from "drizzle-orm";
import { CheckCircle2, CircleAlert, CircleX } from "lucide-react";
import { unstable_cache } from "next/cache";
import { requireAdminPermission } from "@/admin/auth";
import { db } from "@/db";
import { webEnv } from "@/env/web";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

type Check = {
	name: string;
	status: "healthy" | "degraded" | "unavailable";
	latency: number;
	detail: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

async function probe({
	name,
	task,
}: {
	name: string;
	task: () => Promise<{ status?: Check["status"]; detail?: string } | void>;
}): Promise<Check> {
	const start = performance.now();
	try {
		const result = await task();
		return {
			name,
			status: result?.status ?? "healthy",
			latency: Math.round(performance.now() - start),
			detail: result?.detail ?? "Available",
		};
	} catch {
		return {
			name,
			status: "unavailable",
			latency: Math.round(performance.now() - start),
			detail: "Sanitized probe failure",
		};
	}
}

const getChecks = unstable_cache(
	async () => {
		const redis = new Redis({
			url: webEnv.UPSTASH_REDIS_REST_URL,
			token: webEnv.UPSTASH_REDIS_REST_TOKEN,
		});
		const fetchHealth = async (path: string) => {
			const response = await fetch(`${webEnv.BACKEND_INTERNAL_URL}${path}`, {
				cache: "no-store",
				signal: AbortSignal.timeout(4000),
			});
			if (!response.ok) throw new Error("unhealthy");
			const payload: unknown = await response.json();
			return isRecord(payload) ? payload : {};
		};
		return Promise.all([
			Promise.resolve<Check>({
				name: "Next.js web readiness",
				status: "healthy",
				latency: 0,
				detail: "Serving authenticated requests",
			}),
			probe({
				name: "PostgreSQL readiness",
				task: async () => {
					await db.execute(sql`select 1`);
				},
			}),
			probe({
				name: "Upstash Redis",
				task: async () => {
					await redis.ping();
				},
			}),
			probe({
				name: "FastAPI health",
				task: async () => {
					const data = await fetchHealth("/health");
					return {
						status: data.status === "ok" ? "healthy" : "degraded",
						detail: `Backend ${String(data.version ?? "version unknown")}`,
					};
				},
			}),
			probe({
				name: "Export readiness",
				task: async () => {
					const data = await fetchHealth("/health/export");
					return {
						status: data.status === "degraded" ? "degraded" : "healthy",
						detail: `FFmpeg ${data.ffmpegAvailable ? "ready" : "missing"} · Chromium ${data.rendererAvailable ? "ready" : "missing"} · queue ${String(data.queuedExports ?? 0)}`,
					};
				},
			}),
			probe({
				name: "Caption provider availability",
				task: async () => {
					const data = await fetchHealth("/health/timing");
					return {
						status: data.status === "ok" ? "healthy" : "degraded",
						detail: `Worker ${data.captionWorkerImport ? "ready" : "unavailable"}`,
					};
				},
			}),
			probe({
				name: "Supabase Auth",
				task: async () => {
					const response = await fetch(
						`${webEnv.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`,
						{
							headers: { apikey: webEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY },
							cache: "no-store",
							signal: AbortSignal.timeout(3000),
						},
					);
					if (!response.ok) throw new Error("unhealthy");
				},
			}),
		]);
	},
	["admin-system-health"],
	{ revalidate: 15 },
);

export default async function SystemPage() {
	await requireAdminPermission("system.read");
	const checks = await getChecks();
	return (
		<>
			<AdminPageHeader
				title="System health"
				description="Live health, readiness, provider availability, safe latency, queue state, and deployment identity. Secret values are never rendered."
			/>
			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
				{checks.map((check) => {
					const Icon =
						check.status === "healthy"
							? CheckCircle2
							: check.status === "degraded"
								? CircleAlert
								: CircleX;
					return (
						<Card key={check.name} className="border-2">
							<CardHeader className="flex-row items-start justify-between">
								<div>
									<CardTitle>{check.name}</CardTitle>
									<CardDescription>{check.detail}</CardDescription>
								</div>
								<Icon
									className={
										check.status === "healthy"
											? "text-constructive"
											: check.status === "degraded"
												? "text-caution"
												: "text-destructive"
									}
									aria-hidden="true"
								/>
							</CardHeader>
							<CardContent className="flex items-center justify-between">
								<Badge variant="outline">{check.status}</Badge>
								<span className="font-mono text-xs text-muted-foreground">
									{check.latency} ms
								</span>
							</CardContent>
						</Card>
					);
				})}
			</div>
			<p className="mt-4 text-xs text-muted-foreground">
				Checked {new Date().toLocaleString()} · Deployment{" "}
				{process.env.COMMIT_SHA?.slice(0, 12) ?? "commit unavailable"}
			</p>
		</>
	);
}
