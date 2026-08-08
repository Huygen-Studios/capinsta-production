/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- The validated shared v35 contract is the serialized-project source of truth. */
import {
	type CapinstaProjectHandoffManifestV1,
	type ServerBackedMediaDescriptorV1,
	validateCapinstaProjectHandoffManifestV1,
} from "@capinsta/transcript-contract";
import type { SerializedProject } from "@/services/storage/types";

export interface HandoffImportStorage {
	beginProjectHandoffImport(args: {
		project: SerializedProject;
		handoffId: string;
		conversionResultIdentity: string;
	}): Promise<"created" | "reused">;
	saveServerBackedMediaDescriptor(args: {
		projectId: string;
		descriptor: ServerBackedMediaDescriptorV1;
	}): Promise<void>;
	completeProjectHandoffImport(args: {
		projectId: string;
		handoffId: string;
		conversionResultIdentity: string;
	}): Promise<void>;
}

function asSerializedProject(
	manifest: CapinstaProjectHandoffManifestV1,
): SerializedProject {
	// The Rust conversion output is already the authoritative v35 project.
	// This cast crosses the generated-contract/storage boundary without rebuilding
	// timeline elements, captions, trims, playback rates, or ordering.
	return manifest.project as unknown as SerializedProject;
}

export async function importClaimedHandoff({
	value,
	storage,
}: {
	value: unknown;
	storage: HandoffImportStorage;
}): Promise<{ projectId: string; reused: boolean }> {
	const manifest = validateCapinstaProjectHandoffManifestV1(value);
	if (
		manifest.projectSchemaVersion !== 35 ||
		manifest.project.metadata.id !== manifest.targetProjectId
	) {
		throw new Error("handoff_manifest_invalid");
	}
	const result = await storage.beginProjectHandoffImport({
		project: asSerializedProject(manifest),
		handoffId: manifest.handoffId,
		conversionResultIdentity: manifest.conversionResultIdentity,
	});
	for (const descriptor of manifest.mediaAttachments) {
		await storage.saveServerBackedMediaDescriptor({
			projectId: manifest.targetProjectId,
			descriptor,
		});
	}
	await storage.completeProjectHandoffImport({
		projectId: manifest.targetProjectId,
		handoffId: manifest.handoffId,
		conversionResultIdentity: manifest.conversionResultIdentity,
	});
	return {
		projectId: manifest.targetProjectId,
		reused: result === "reused",
	};
}
