import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { webEnv } from "@/env/web";

type DependencyStatus = "ok" | "unavailable";

type DependencyCheck = {
	status: DependencyStatus;
	latencyMs: number;
};

async function probe(task: () => Promise<void>): Promise<DependencyCheck> {
	const start = performance.now();
	try {
		await task();
		return {
			status: "ok",
			latencyMs: Math.round(performance.now() - start),
		};
	} catch {
		return {
			status: "unavailable",
			latencyMs: Math.round(performance.now() - start),
		};
	}
}

export function livePayload() {
	return {
		status: "ok",
		service: "capinsta-web",
		kind: "liveness",
		generatedAt: new Date().toISOString(),
		release: process.env.COMMIT_SHA ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? null,
	};
}

export async function readyPayload() {
	const [database, backend] = await Promise.all([
		probe(async () => {
			await db.execute(sql`select 1`);
		}),
		probe(async () => {
			const response = await fetch(`${webEnv.BACKEND_INTERNAL_URL}/health/ready`, {
				cache: "no-store",
				signal: AbortSignal.timeout(2500),
			});
			if (!response.ok) throw new Error("backend_unavailable");
		}),
	]);
	const ready = database.status === "ok" && backend.status === "ok";
	return {
		status: ready ? "ok" : "degraded",
		service: "capinsta-web",
		kind: "readiness",
		ready,
		generatedAt: new Date().toISOString(),
		release: process.env.COMMIT_SHA ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? null,
		dependencies: {
			database,
			backend,
		},
	};
}
