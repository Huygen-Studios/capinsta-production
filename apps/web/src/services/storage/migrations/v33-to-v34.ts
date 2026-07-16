import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV33ToV34 } from "./transformers/v33-to-v34";

export class V33toV34Migration extends StorageMigration {
	from = 33;
	to = 34;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV33ToV34({ project });
	}
}
