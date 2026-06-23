import { desc, eq, sql } from "drizzle-orm";
import { requireAdminPermission } from "@/admin/auth";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminTranscriptionControls } from "@/components/admin/admin-transcription-controls";
import { db } from "@/db";
import {
	captionJobs,
	providerHealthEvents,
	transcriptionConfigurations,
} from "@/db/schema";
import { isTranscriptionProvider } from "@/transcription/provider-catalog";

export default async function TranscriptionPage() {
	await requireAdminPermission("system.read");
	const [configs, health, lastRequest] = await Promise.all([
		db
			.select()
			.from(transcriptionConfigurations)
			.orderBy(desc(transcriptionConfigurations.updatedAt))
			.limit(20),
		db
			.select()
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
	]);
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
				: lastRequest[0]
					? "backend env fallback"
					: "save draft to test");
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
				lastProductionRequest={last}
			/>
		</>
	);
}
