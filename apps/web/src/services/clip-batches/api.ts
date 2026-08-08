/* eslint-disable opencut/prefer-object-params -- Small REST client helpers mirror endpoint path parameters. */
import { z } from "zod";
import { clipperApiRequest } from "@/services/automatic-clipper/api";
import type { CapinstaJobDetailResponse } from "@/capinsta/apiTypes";
import { MAX_CLIP_DURATION_MS } from "./constants";

export { MAX_CLIP_DURATION_MS } from "./constants";

const itemSchema = z.object({
	schemaVersion: z.literal(1),
	id: z.string().uuid(),
	batchId: z.string().uuid(),
	ordinal: z.number().int().positive(),
	title: z.string(),
	sourceStartMs: z.number().int().nonnegative(),
	sourceEndMs: z.number().int().positive(),
	durationMs: z.number().int().positive().max(MAX_CLIP_DURATION_MS),
	status: z.string(),
	selectedForExport: z.boolean(),
	childProjectId: z.string().nullable(),
	childProjectRevision: z.number().int().positive().nullable(),
	captionStatus: z.string(),
	captionJobId: z.string().nullable(),
	headingStatus: z.string(),
	exportStatus: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
	revision: z.number().int().positive(),
});

const batchSchema = z.object({
	schemaVersion: z.literal(1),
	id: z.string().uuid(),
	ownerUserId: z.string().uuid(),
	sourceMediaAssetId: z.string().uuid(),
	sourceMediaRevision: z.number().int().positive(),
	sourceDurationMs: z.number().int().positive(),
	sourceProjectId: z.string().nullable(),
	title: z.string(),
	status: z.string(),
	platformPreset: z.enum(["instagram_reels", "youtube_shorts", "tiktok", "custom"]),
	captionsEnabled: z.boolean(),
	headingsEnabled: z.boolean(),
	captionPreset: z.string().nullable(),
	maximumClipDurationMs: z.number().int().positive().max(MAX_CLIP_DURATION_MS),
	createdAt: z.string(),
	updatedAt: z.string(),
	revision: z.number().int().positive(),
	items: z.array(itemSchema),
});

export type ClipBatchItemV1 = z.infer<typeof itemSchema>;
export type ClipBatchV1 = z.infer<typeof batchSchema>;

const key = (scope: string) => `${scope}:${crypto.randomUUID()}`;

export async function getMediaReadiness(mediaAssetId: string) {
	return z
		.object({
			mediaAssetId: z.string().uuid(),
			status: z.string(),
			durationMs: z.number().int().nonnegative().nullable(),
			width: z.number().int().positive().nullable(),
			height: z.number().int().positive().nullable(),
			revision: z.number().int().positive(),
			ready: z.boolean(),
		})
		.parse(await clipperApiRequest(`/clipping/media/assets/${encodeURIComponent(mediaAssetId)}`));
}

export async function createClipBatch(input: {
	sourceMediaAssetId: string;
	title: string;
	platformPreset?: ClipBatchV1["platformPreset"];
	captionsEnabled?: boolean;
	headingsEnabled?: boolean;
}) {
	return batchSchema.parse(
		await clipperApiRequest("/clipping/batches", {
			method: "POST",
			headers: { "Content-Type": "application/json", "Idempotency-Key": `clip-batch:${input.sourceMediaAssetId}` },
			body: JSON.stringify(input),
		}),
	);
}

export async function getClipBatch(batchId: string) {
	return batchSchema.parse(await clipperApiRequest(`/clipping/batches/${encodeURIComponent(batchId)}`));
}

export async function deleteClipBatch(batchId: string) {
	return z.object({ deleted: z.literal(true), batchId: z.string().uuid(), sourceMediaPreserved: z.literal(true) }).parse(
		await clipperApiRequest(`/clipping/batches/${batchId}`, { method: "DELETE" }),
	);
}

export async function deleteClipBatchSourceMedia(mediaAssetId: string) {
	return clipperApiRequest(`/clipping/media/${encodeURIComponent(mediaAssetId)}`, { method: "DELETE" });
}

export async function deleteMaterializedClipProject(projectId: string) {
	return clipperApiRequest(`/clipping/projects/${encodeURIComponent(projectId)}`, {
		method: "DELETE",
		headers: { "Idempotency-Key": `manual-clip-delete:${projectId}` },
	});
}

export async function updateClipBatch(
	batchId: string,
	input: { expectedRevision: number; captionsEnabled?: boolean; headingsEnabled?: boolean; title?: string; platformPreset?: ClipBatchV1["platformPreset"]; maximumClipDurationMs?: number },
) {
	return batchSchema.parse(
		await clipperApiRequest(`/clipping/batches/${encodeURIComponent(batchId)}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		}),
	);
}

export async function addClipBatchItem(
	batchId: string,
	input: { title: string; sourceStartMs: number; sourceEndMs: number },
) {
	return itemSchema.parse(
		await clipperApiRequest(`/clipping/batches/${encodeURIComponent(batchId)}/items`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		}),
	);
}

export async function updateClipBatchItem(
	batchId: string,
	itemId: string,
	input: { expectedRevision: number; title?: string; sourceStartMs?: number; sourceEndMs?: number; selectedForExport?: boolean },
) {
	return itemSchema.parse(
		await clipperApiRequest(
			`/clipping/batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}`,
			{ method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
		),
	);
}

export async function deleteClipBatchItem(batchId: string, itemId: string) {
	await clipperApiRequest(`/clipping/batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}`, {
		method: "DELETE",
	});
}

export async function resetClipBatchItem(batchId: string, itemId: string) {
	return itemSchema.parse(await clipperApiRequest(
		`/clipping/batches/${encodeURIComponent(batchId)}/items/${encodeURIComponent(itemId)}/reset-materialization`,
		{ method: "POST" },
	));
}

export async function reorderClipBatchItems(batch: ClipBatchV1, itemIds: string[]) {
	return batchSchema.parse(
		await clipperApiRequest(`/clipping/batches/${encodeURIComponent(batch.id)}/items/reorder`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ expectedBatchRevision: batch.revision, itemIds }),
		}),
	);
}

export async function materializeClipBatch(batch: ClipBatchV1) {
	return clipperApiRequest(`/clipping/batches/${encodeURIComponent(batch.id)}/materialize`, {
		method: "POST",
		headers: { "Content-Type": "application/json", "Idempotency-Key": key("materialize") },
		body: JSON.stringify({ expectedRevision: batch.revision }),
	});
}

export async function syncClipEditorProject(
	batchId: string,
	item: ClipBatchItemV1,
	project: unknown,
) {
	return itemSchema.parse(
		await clipperApiRequest(`/clipping/batches/${batchId}/items/${item.id}/editor-project`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ expectedItemRevision: item.revision, project }),
		}),
	);
}

export async function startClipCaption(batchId: string, itemId: string, languageMode = "auto") {
	return z.object({ job_id: z.string(), status: z.string(), replayed: z.boolean() }).parse(
		await clipperApiRequest(`/clipping/batches/${batchId}/captions`, {
			method: "POST",
			headers: { "Content-Type": "application/json", "Idempotency-Key": `clip-caption:${batchId}:${itemId}` },
			body: JSON.stringify({ itemId, languageMode }),
		}),
	);
}

export async function getClipCaption(batchId: string, itemId: string) {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Required envelope validated; optional provider transcript fields remain extensible.
	return z.object({ job_id: z.string(), status: z.string(), progress: z.number().nullable(), filename: z.string() }).passthrough().parse(
		await clipperApiRequest(`/clipping/batches/${batchId}/captions/${itemId}`),
	) as unknown as CapinstaJobDetailResponse;
}

const batchExportSchema = z.object({
	schemaVersion: z.literal(1),
	id: z.string().uuid(),
	batchId: z.string().uuid(),
	status: z.string(),
	items: z.array(z.object({
		itemId: z.string().uuid(),
		exportId: z.string().uuid(),
		ordinal: z.number().int().positive(),
		filename: z.string(),
		status: z.string(),
	})),
	readyAt: z.string().nullable(),
});

export type ClipBatchExportV1 = z.infer<typeof batchExportSchema>;

function exportKey(batch: ClipBatchV1, itemIds: string[]) {
	const revisions = batch.items
		.filter((item) => itemIds.includes(item.id))
		.map((item) => `${item.id}:${item.childProjectRevision ?? 0}`)
		.sort()
		.join(",");
	let hash = 2166136261;
	for (const character of revisions) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
	return `clip-batch-export:${batch.id}:${(hash >>> 0).toString(16)}`;
}

export async function createClipBatchExport(batch: ClipBatchV1, itemIds: string[]) {
	return batchExportSchema.parse(await clipperApiRequest(`/clipping/batches/${batch.id}/exports`, {
		method: "POST",
		headers: { "Content-Type": "application/json", "Idempotency-Key": exportKey(batch, itemIds) },
		body: JSON.stringify({ itemIds }),
	}));
}

export async function getClipBatchExport(batchId: string, exportId: string) {
	return batchExportSchema.parse(await clipperApiRequest(`/clipping/batches/${batchId}/exports/${exportId}`));
}

export async function finalizeClipBatchExport(batchId: string, exportId: string) {
	return batchExportSchema.parse(await clipperApiRequest(`/clipping/batches/${batchId}/exports/${exportId}/finalize`, { method: "POST" }));
}

export async function getClipBatchExportDownload(batchId: string, exportId: string) {
	return z.object({ exportId: z.string().uuid(), url: z.string().url() }).parse(
		await clipperApiRequest(`/clipping/batches/${batchId}/exports/${exportId}/download`),
	);
}
