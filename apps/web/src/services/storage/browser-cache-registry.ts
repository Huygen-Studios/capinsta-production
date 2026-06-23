import { IndexedDBAdapter } from "./indexeddb-adapter";

export const BROWSER_CACHE_BUDGET_BYTES = 64 * 1024 * 1024;

export type BrowserStoredAssetType =
	| "project_snapshot"
	| "media_metadata"
	| "thumbnail"
	| "waveform"
	| "proxy";

export interface BrowserCacheEntry {
	id: string;
	projectId: string;
	assetType: BrowserStoredAssetType;
	estimatedByteSize: number;
	createdAt: string;
	lastAccessedAt: string;
	evictable: boolean;
}

export function projectCacheEntryIds({
	entries,
	projectId,
}: {
	entries: BrowserCacheEntry[];
	projectId: string;
}): string[] {
	return entries
		.filter((entry) => entry.projectId === projectId)
		.map((entry) => entry.id);
}

export function lruEntriesToEvict({
	entries,
	budgetBytes = BROWSER_CACHE_BUDGET_BYTES,
}: {
	entries: BrowserCacheEntry[];
	budgetBytes?: number;
}): BrowserCacheEntry[] {
	let total = entries.reduce(
		(sum, entry) => sum + (entry.evictable ? entry.estimatedByteSize : 0),
		0,
	);
	if (total <= budgetBytes) return [];
	const evicted: BrowserCacheEntry[] = [];
	for (const entry of entries
		.filter((candidate) => candidate.evictable)
		.toSorted((left, right) =>
			left.lastAccessedAt.localeCompare(right.lastAccessedAt),
		)) {
		if (total <= budgetBytes) break;
		total -= entry.estimatedByteSize;
		evicted.push(entry);
	}
	return evicted;
}

class BrowserCacheRegistry {
	private unavailable = false;
	private adapter = new IndexedDBAdapter<BrowserCacheEntry>({
		dbName: "capinsta-browser-cache-registry",
		storeName: "entries",
		version: 1,
	});

	async register({
		id,
		projectId,
		assetType,
		estimatedByteSize,
		evictable = true,
	}: Omit<BrowserCacheEntry, "createdAt" | "lastAccessedAt"> & {
		evictable?: boolean;
	}): Promise<BrowserCacheEntry[]> {
		if (this.unavailable) return [];
		const now = new Date().toISOString();
		try {
			const previous = await this.adapter.get(id);
			await this.adapter.set({
				key: id,
				value: {
					id,
					projectId,
					assetType,
					estimatedByteSize: Math.max(0, estimatedByteSize),
					createdAt: previous?.createdAt ?? now,
					lastAccessedAt: now,
					evictable,
				},
			});
			return this.evictToBudget();
		} catch {
			this.unavailable = true;
			return [];
		}
	}

	async touch(id: string): Promise<void> {
		if (this.unavailable) return;
		try {
			const entry = await this.adapter.get(id);
			if (!entry) return;
			await this.adapter.set({
				key: id,
				value: { ...entry, lastAccessedAt: new Date().toISOString() },
			});
		} catch {
			this.unavailable = true;
		}
	}

	async deleteProject(projectId: string): Promise<void> {
		if (this.unavailable) return;
		try {
			const entries = await this.adapter.getAll();
			for (const id of projectCacheEntryIds({ entries, projectId })) {
				await this.adapter.remove(id);
			}
		} catch {
			this.unavailable = true;
		}
	}

	async cleanupOrphans(validProjectIds: Set<string>): Promise<void> {
		if (this.unavailable) return;
		try {
			for (const entry of await this.adapter.getAll()) {
				if (!validProjectIds.has(entry.projectId)) {
					await this.adapter.remove(entry.id);
				}
			}
		} catch {
			this.unavailable = true;
		}
	}

	private async evictToBudget(): Promise<BrowserCacheEntry[]> {
		const entries = await this.adapter.getAll();
		const evicted = lruEntriesToEvict({ entries });
		for (const entry of evicted) {
			await this.adapter.remove(entry.id);
		}
		return evicted;
	}
}

export const browserCacheRegistry = new BrowserCacheRegistry();
