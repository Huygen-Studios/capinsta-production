import { CapinstaApiError, getCapinstaJob } from "./apiClient";

const LOCAL_INACTIVITY_TTL_MS = 15 * 60_000;

export async function findExpiredLocalProjectIds({
	projects,
	baseUrl,
	fetchImpl = fetch,
	now = Date.now(),
}: {
	projects: Array<{
		metadata: { id: string; updatedAt: Date };
		capinstaServerJobId?: string;
		capinstaLeftAt?: string;
	}>;
	baseUrl: string;
	fetchImpl?: typeof fetch;
	now?: number;
}): Promise<string[]> {
	const checks = await Promise.all(
		projects.map(async (project) => {
			if (!project.capinstaServerJobId) {
				const inactiveSince = Date.parse(
					project.capinstaLeftAt ?? project.metadata.updatedAt.toISOString(),
				);
				return now - inactiveSince >= LOCAL_INACTIVITY_TTL_MS
					? project.metadata.id
					: null;
			}
			try {
				await getCapinstaJob({
					baseUrl,
					jobId: project.capinstaServerJobId,
					fetchImpl,
				});
				return null;
			} catch (error) {
				return error instanceof CapinstaApiError && error.status === 410
					? project.metadata.id
					: null;
			}
		}),
	);
	return checks.filter((id): id is string => id !== null);
}
