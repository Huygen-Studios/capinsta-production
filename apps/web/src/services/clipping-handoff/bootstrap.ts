import { storageService } from "@/services/storage/service";
import { claimHandoff, completeHandoff } from "./api";
import { importClaimedHandoff } from "./import";

export async function bootstrapHandoff({
	handoffId,
}: {
	handoffId: string;
}): Promise<{ projectId: string; reused: boolean }> {
	const claimed = await claimHandoff({ handoffId });
	const imported = await importClaimedHandoff({
		value: claimed.handoff,
		storage: storageService,
	});
	await completeHandoff({
		handoffId,
		importedProjectId: imported.projectId,
		importedProjectRevision: 1,
	});
	return imported;
}
