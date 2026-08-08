import { describe, expect, mock, test } from "bun:test";
import {
	lruEntriesToEvict,
	projectCacheEntryIds,
	type BrowserCacheEntry,
} from "./browser-cache-registry";
import {
	isStorageQuotaExceededError,
	StorageQuotaExceededError,
} from "./quota";

mock.module("opencut-wasm", () => ({
	TICKS_PER_SECOND: () => 120_000,
	mediaTimeFromSeconds: ({ seconds }: { seconds: number }) =>
		Math.round(seconds * 120_000),
	mediaTimeToSeconds: ({ time }: { time: number }) => time / 120_000,
	lastFrameTime: ({ duration }: { duration: number }) => duration,
	parseTimecode: () => undefined,
	roundToFrame: ({ time }: { time: number }) => time,
	snappedSeekTime: ({ time }: { time: number }) => time,
}));

const { shouldPersistMediaFileInBrowser } = await import("./service");

const entry = ({
	id,
	projectId,
	bytes,
	lastAccessedAt,
}: {
	id: string;
	projectId: string;
	bytes: number;
	lastAccessedAt: string;
}): BrowserCacheEntry => ({
	id,
	projectId,
	assetType: "thumbnail",
	estimatedByteSize: bytes,
	createdAt: lastAccessedAt,
	lastAccessedAt,
	evictable: true,
});

describe("storage lifecycle safety", () => {
	test("server-backed large media is never persisted as a browser file", () => {
		expect(
			shouldPersistMediaFileInBrowser({
				serverAssetId: "server-asset-1",
			}),
		).toBe(false);
		expect(shouldPersistMediaFileInBrowser({})).toBe(true);
	});

	test("quota errors are recoverable and detected consistently", () => {
		expect(
			isStorageQuotaExceededError({
				error: new StorageQuotaExceededError({
					requiredBytes: 189 * 1024 * 1024,
				}),
			}),
		).toBe(true);
		expect(
			isStorageQuotaExceededError({
				error: new DOMException("quota reached", "QuotaExceededError"),
			}),
		).toBe(true);
	});

	test("project cache deletion never selects another project's entries", () => {
		const entries = [
			entry({
				id: "a-1",
				projectId: "project-a",
				bytes: 10,
				lastAccessedAt: "2026-01-01T00:00:00Z",
			}),
			entry({
				id: "b-1",
				projectId: "project-b",
				bytes: 10,
				lastAccessedAt: "2026-01-01T00:00:01Z",
			}),
		];
		expect(projectCacheEntryIds({ entries, projectId: "project-a" })).toEqual([
			"a-1",
		]);
	});

	test("cache eviction is size based and least-recently-used", () => {
		const entries = [
			entry({
				id: "old",
				projectId: "project-a",
				bytes: 40,
				lastAccessedAt: "2026-01-01T00:00:00Z",
			}),
			entry({
				id: "new",
				projectId: "project-a",
				bytes: 40,
				lastAccessedAt: "2026-01-02T00:00:00Z",
			}),
		];
		expect(
			lruEntriesToEvict({ entries, budgetBytes: 50 }).map((item) => item.id),
		).toEqual(["old"]);
	});
});
