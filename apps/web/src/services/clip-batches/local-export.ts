import { Zip, ZipPassThrough, strToU8 } from "fflate";
import type { LocalClipBatchV1, LocalClipItemV1 } from "@/project/types";
import { sanitizeClipFilename } from "./ranges";

export interface LocalClipManifestV1 {
	schemaVersion: 1;
	batchId: string;
	exportedAt: string;
	sourceFileName: string;
	clips: Array<{
		id: string;
		order: number;
		title: string;
		sourceStartMs: number;
		sourceEndMs: number;
		durationMs: number;
		filename: string;
	}>;
}

export async function createLocalClipZip({
	batch,
	items,
	render,
	onProgress,
	onError,
}: {
	batch: LocalClipBatchV1;
	items: LocalClipItemV1[];
	render: (item: LocalClipItemV1, index: number) => Promise<ArrayBuffer>;
	onProgress?: (
		item: LocalClipItemV1,
		index: number,
		status: "rendering" | "complete",
	) => void;
	onError?: (item: LocalClipItemV1, index: number, error: Error) => void;
}): Promise<Blob> {
	const chunks: BlobPart[] = [];
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const done = new Promise<void>((ok, fail) => {
		resolve = ok;
		reject = fail;
	});
	const zip = new Zip((error, chunk, final) => {
		if (error) reject(error);
		else {
			chunks.push(
				chunk.byteOffset === 0 &&
					chunk.byteLength === chunk.buffer.byteLength &&
					chunk.buffer instanceof ArrayBuffer
					? chunk.buffer
					: chunk.slice().buffer,
			);
			if (final) resolve();
		}
	});
	const manifest: LocalClipManifestV1 = {
		schemaVersion: 1,
		batchId: batch.id,
		exportedAt: new Date().toISOString(),
		sourceFileName: batch.sourceFileName,
		clips: [],
	};
	let firstError: Error | undefined;
	for (const [index, item] of items.entries()) {
		onProgress?.(item, index, "rendering");
		try {
			const filename = `clip-${String(index + 1).padStart(2, "0")}-${sanitizeClipFilename(item.title)}.mp4`;
			const buffer = await render(item, index);
			const file = new ZipPassThrough(filename);
			zip.add(file);
			file.push(new Uint8Array(buffer), true);
			manifest.clips.push({
				id: item.id,
				order: index + 1,
				title: item.title,
				sourceStartMs: item.sourceStartMs,
				sourceEndMs: item.sourceEndMs,
				durationMs: item.sourceEndMs - item.sourceStartMs,
				filename,
			});
			onProgress?.(item, index, "complete");
		} catch (error) {
			const failure =
				error instanceof Error ? error : new Error("Clip rendering failed.");
			firstError ??= failure;
			onError?.(item, index, failure);
		}
	}
	if (manifest.clips.length === 0) {
		zip.terminate();
		throw firstError ?? new Error("No clips could be rendered.");
	}
	const manifestEntry = new ZipPassThrough("manifest.json");
	zip.add(manifestEntry);
	manifestEntry.push(strToU8(JSON.stringify(manifest, null, 2)), true);
	zip.end();
	await done;
	return new Blob(chunks, { type: "application/zip" });
}

export function downloadBlob({
	blob,
	filename,
}: {
	blob: Blob;
	filename: string;
}): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.click();
	queueMicrotask(() => URL.revokeObjectURL(url));
}
