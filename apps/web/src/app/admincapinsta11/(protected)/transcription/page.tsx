import { desc, eq, sql } from "drizzle-orm";
import { requireAdminPermission } from "@/admin/auth";
import { listAdminTranscriptionConfigurations } from "@/admin/transcription-config-db";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminTranscriptionControls } from "@/components/admin/admin-transcription-controls";
import { db } from "@/db";
import {
	captionJobs,
	providerHealthEvents,
} from "@/db/schema";
import { webEnv } from "@/env/web";
import { isTranscriptionProvider } from "@/transcription/provider-catalog";

export default async function TranscriptionPage() {
	await requireAdminPermission("system.read");
	let configs: Awaited<ReturnType<typeof listAdminTranscriptionConfigurations>>;
	let health: { status: string }[];
	let lastRequest:
		| { completedAt: Date | null; provider: string | null; model: string | null }[]
		| [];
	let timingHealth: Record<string, unknown> | null = null;
	try {
		[configs, health, lastRequest, timingHealth] = await Promise.all([
			listAdminTranscriptionConfigurations(db, 20),
			db
				.select({ status: providerHealthEvents.status })
				.from(providerHealthEvents)
				.where(eq(providerHealthEvents.component, "transcription"))
				.orderBy(desc(providerHealthEvents.checkedAt))
				.limit(1),
			db
				.select({
					completedAt: captionJobs.completedAt,
					provider: captionJobs.provider,
					model: captionJobs.transcriptionModel,
				})
				.from(captionJobs)
				.where(sql`${captionJobs.status} in ('completed','succeeded')`)
				.orderBy(desc(captionJobs.completedAt))
				.limit(1),
			fetch(`${webEnv.BACKEND_INTERNAL_URL}/health/timing`, {
				cache: "no-store",
			}).then((response) => response.ok ? response.json() : null).catch(() => null),
		]);
	} catch (error) {
		const correlationId = crypto.randomUUID();
		console.error("[admin transcription] configuration load failed", {
			correlationId,
			error,
		});
		return <TranscriptionLoadError correlationId={correlationId} />;
	}
	const serializedConfigs = configs.map((item) => ({
		...item,
		provider: isTranscriptionProvider(item.provider) ? item.provider : "gemini",
		testedAt: item.testedAt?.toISOString() ?? null,
		activatedAt: item.activatedAt?.toISOString() ?? null,
		createdAt: item.createdAt.toISOString(),
		updatedAt: item.updatedAt.toISOString(),
	}));
	const serializedActive =
		serializedConfigs.find((item) => item.status === "active") ?? null;
	const healthStatus =
		health[0]?.status ??
		(serializedActive?.testStatus === "passed"
			? "healthy"
			: serializedActive
				? "untested"
				: serializedConfigs.length
					? "database_draft_only"
					: lastRequest[0]
						? "env_fallback_no_active_database_configuration"
						: "database_no_configuration");
	const last = lastRequest[0]
		? `${lastRequest[0].provider ?? "provider"} ${lastRequest[0].model ?? ""} at ${lastRequest[0].completedAt?.toLocaleString() ?? "unknown time"}`
		: null;
	return (
		<>
			<AdminPageHeader
				title="Transcription"
				description="Administrator-controlled caption transcription provider and model selection."
			/>
			<AdminTranscriptionControls
				active={serializedActive}
				configurations={serializedConfigs}
				healthStatus={healthStatus}
				timingHealth={timingHealth}
				lastProductionRequest={last}
			/>
		</>
	);
}

function TranscriptionLoadError({ correlationId }: { correlationId: string }) {
	return (
		<>
			<AdminPageHeader
				title="Transcription"
				description="Administrator-controlled caption transcription provider and model selection."
			/>
			<section className="border-2 border-foreground bg-background p-6 shadow-[6px_6px_0_var(--cap-shadow-color)]">
				<p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-primary">
					Configuration error
				</p>
				<h2 className="text-2xl font-black">
					Transcription configuration could not be loaded.
				</h2>
				<p className="mt-3 max-w-2xl text-sm text-muted-foreground">
					The admin page caught a recoverable configuration load problem. Check
					the server log with this correlation ID, then retry the page.
				</p>
				<div className="mt-4 border border-border bg-muted p-3 text-sm">
					<p>
						<span className="font-semibold">Error code:</span>{" "}
						transcription_configuration_load_failed
					</p>
					<p>
						<span className="font-semibold">Correlation ID:</span>{" "}
						{correlationId}
					</p>
				</div>
				<div className="mt-5 flex flex-wrap gap-3">
					<a
						href="/admincapinsta11/transcription"
						className="border-2 border-foreground bg-primary px-4 py-2 text-sm font-bold text-primary-foreground shadow-[4px_4px_0_var(--cap-shadow-color)]"
					>
						Retry
					</a>
					<a
						href="/admincapinsta11/overview"
						className="border border-border bg-background px-4 py-2 text-sm font-semibold"
					>
						Back to admin dashboard
					</a>
				</div>
			</section>
		</>
	);
}
