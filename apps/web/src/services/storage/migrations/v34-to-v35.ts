import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV34ToV35 } from "./transformers/v34-to-v35";

export class V34toV35Migration extends StorageMigration {
	from = 34;
	to = 35;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV34ToV35({ project });
	}
}
