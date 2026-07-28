/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-type-assertion -- Fixture mutations intentionally exercise the untrusted JSON boundary. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ServerBackedMediaDescriptorV1 } from "@capinsta/transcript-contract";
import { importClaimedHandoff, type HandoffImportStorage } from "./import";
import type { SerializedProject } from "@/services/storage/types";

const ASSET_ID = "11111111-1111-4111-8111-111111111111";
const HANDOFF_ID = "22222222-2222-4222-8222-222222222222";

function manifest() {
	const fixture = JSON.parse(
		readFileSync(
			path.resolve(
				process.cwd(),
				"../../contracts/fixtures/capinsta-project-conversion-v1/valid/project-with-remapped-captions.json",
			),
			"utf8",
		),
	) as Record<string, any>;
	const conversion = fixture.result;
	conversion.project.metadata.id = "capinsta_import_test";
	conversion.targetProjectId = "capinsta_import_test";
	conversion.project.scenes[0].tracks.main.elements[0].mediaId = ASSET_ID;
	conversion.project.scenes[0].tracks.main.elements[0].sourceAssetId = ASSET_ID;
	return {
		schemaVersion: 1,
		handoffId: HANDOFF_ID,
		clipProjectId: conversion.sourceClipProjectId,
		clipProjectRevision: conversion.sourceClipProjectRevision,
		conversionResultIdentity: "a".repeat(64),
		targetProjectId: conversion.targetProjectId,
		projectSchemaVersion: 35,
		project: conversion.project,
		mediaAttachments: [
			{
				schemaVersion: 1,
				mediaId: ASSET_ID,
				mediaAssetId: ASSET_ID,
				sourceType: "server-backed",
				mediaKind: "video",
				mimeType: "video/mp4",
				displayName: "Synthetic source.mp4",
				sizeBytes: 100,
				durationMs: 60_000,
				width: 1080,
				height: 1920,
				storageProvider: "supabase",
				accessMode: "authenticated-server-backed",
				requiresBrowserPersistence: false,
			},
		],
		provenance: {
			sourceClipProjectId: conversion.sourceClipProjectId,
			sourceClipProjectRevision: conversion.sourceClipProjectRevision,
			conversionSchemaVersion: 1,
			convertedAt: null,
		},
		expiresAt: "2030-01-01T00:00:00Z",
		warnings: ["project_field_defaulted"],
		metadata: {},
	};
}

class MemoryImportStorage implements HandoffImportStorage {
	project: SerializedProject | null = null;
	descriptor: ServerBackedMediaDescriptorV1 | null = null;
	status: "none" | "importing" | "imported" = "none";
	identity: string | null = null;

	async beginProjectHandoffImport(args: {
		project: SerializedProject;
		handoffId: string;
		conversionResultIdentity: string;
	}): Promise<"created" | "reused"> {
		if (this.project && this.identity !== args.conversionResultIdentity) {
			throw new Error("handoff_project_conflict");
		}
		if (this.project) return "reused";
		this.project = structuredClone(args.project);
		this.identity = args.conversionResultIdentity;
		this.status = "importing";
		return "created";
	}

	async saveServerBackedMediaDescriptor(args: {
		projectId: string;
		descriptor: ServerBackedMediaDescriptorV1;
	}): Promise<void> {
		this.descriptor = structuredClone(args.descriptor);
	}

	async completeProjectHandoffImport(): Promise<void> {
		if (!this.project || !this.descriptor) throw new Error("incomplete");
		this.status = "imported";
	}
}

describe("editable clipping handoff import", () => {
	test("persists the exact v35 project, registers stable media, and is retry-safe", async () => {
		const value = manifest();
		const storage = new MemoryImportStorage();
		const first = await importClaimedHandoff({ value, storage });
		expect(first).toEqual({
			projectId: "capinsta_import_test",
			reused: false,
		});
		expect(storage.project).toEqual(value.project);
		expect(storage.descriptor?.mediaId).toBe(ASSET_ID);
		expect(storage.descriptor?.requiresBrowserPersistence).toBe(false);
		expect(storage.status).toBe("imported");

		// Simulate a normal editor save before a network/redirect retry.
		if (!storage.project) throw new Error("project_missing");
		storage.project.metadata.name = "User-edited title";
		const replay = await importClaimedHandoff({ value, storage });
		expect(replay.reused).toBe(true);
		expect(storage.project.metadata.name).toBe("User-edited title");
		expect(JSON.stringify(storage.project)).not.toContain("signed");
		expect(JSON.stringify(storage.descriptor)).not.toContain("url");
	});

	test("does not complete when attachment persistence fails", async () => {
		const storage = new MemoryImportStorage();
		storage.saveServerBackedMediaDescriptor = async () => {
			throw new Error("quota");
		};
		await expect(
			importClaimedHandoff({ value: manifest(), storage }),
		).rejects.toThrow("quota");
		expect(storage.status).toBe("importing");
	});

	test("rejects a conflicting imported identity without overwriting", async () => {
		const storage = new MemoryImportStorage();
		await importClaimedHandoff({ value: manifest(), storage });
		storage.identity = "different";
		await expect(
			importClaimedHandoff({ value: manifest(), storage }),
		).rejects.toThrow("handoff_project_conflict");
		expect(storage.project?.metadata.id).toBe("capinsta_import_test");
	});

	test("rejects signed access data and unresolved media references", async () => {
		const withSignedUrl = manifest();
		withSignedUrl.mediaAttachments[0].signedUrl =
			"https://storage.invalid/object?token=secret";
		await expect(
			importClaimedHandoff({
				value: withSignedUrl,
				storage: new MemoryImportStorage(),
			}),
		).rejects.toThrow("media_attachment_invalid");

		const missing = manifest();
		missing.mediaAttachments = [];
		await expect(
			importClaimedHandoff({
				value: missing,
				storage: new MemoryImportStorage(),
			}),
		).rejects.toThrow("handoff_manifest_invalid");
	});
});
