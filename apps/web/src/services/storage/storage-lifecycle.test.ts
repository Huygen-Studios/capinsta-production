import { describe, expect, test } from "bun:test";
import {
	lruEntriesToEvict,
	projectCacheEntryIds,
	type BrowserCacheEntry,
} from "./browser-cache-registry";
import {
	isStorageQuotaExceededError,
	StorageQuotaExceededError,
} from "./quota";
import { shouldPersistMediaFileInBrowser } from "./service";

const entry = (
	id: string,
	projectId: string,
	bytes: number,
	lastAccessedAt: string,
): BrowserCacheEntry => ({
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
			entry("a-1", "project-a", 10, "2026-01-01T00:00:00Z"),
			entry("b-1", "project-b", 10, "2026-01-01T00:00:01Z"),
		];
		expect(projectCacheEntryIds({ entries, projectId: "project-a" })).toEqual([
			"a-1",
		]);
	});

	test("cache eviction is size based and least-recently-used", () => {
		const entries = [
			entry("old", "project-a", 40, "2026-01-01T00:00:00Z"),
			entry("new", "project-a", 40, "2026-01-02T00:00:00Z"),
		];
		expect(
			lruEntriesToEvict({ entries, budgetBytes: 50 }).map(
				(item) => item.id,
			),
		).toEqual(["old"]);
	});
});
