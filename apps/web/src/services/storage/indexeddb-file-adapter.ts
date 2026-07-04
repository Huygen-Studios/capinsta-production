import type { StorageAdapter } from "./types";
import {
	MediaStorageUnavailableError,
	getIndexedDBStorageCapability,
} from "./storage-capability";

interface IndexedDBFileRecord {
	id: string;
	file: File;
}

export class IndexedDBFileAdapter implements StorageAdapter<File> {
	private dbName: string;
	private storeName: string;
	private version: number;

	constructor({
		dbName,
		storeName,
		version = 1,
	}: {
		dbName: string;
		storeName: string;
		version?: number;
	}) {
		this.dbName = dbName;
		this.storeName = storeName;
		this.version = version;
	}

	private async getDB(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const capability = getIndexedDBStorageCapability();
			if (!capability.supported) {
				reject(
					new MediaStorageUnavailableError({
						reason: capability.reason,
						message: capability.message,
						cause: capability.cause,
					}),
				);
				return;
			}

			const request = indexedDB.open(this.dbName, this.version);

			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve(request.result);

			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(this.storeName)) {
					db.createObjectStore(this.storeName, { keyPath: "id" });
				}
			};
		});
	}

	async get(key: string): Promise<File | null> {
		const db = await this.getDB();
		const transaction = db.transaction([this.storeName], "readonly");
		const store = transaction.objectStore(this.storeName);

		return new Promise((resolve, reject) => {
			const request = store.get(key);
			request.onerror = () => reject(request.error);
			request.onsuccess = () => {
				resolve(readFileRecord({ value: request.result })?.file ?? null);
			};
		});
	}

	async set({
		key,
		value,
	}: {
		key: string;
		value: File;
	}): Promise<void> {
		const db = await this.getDB();
		const transaction = db.transaction([this.storeName], "readwrite");
		const store = transaction.objectStore(this.storeName);

		return new Promise((resolve, reject) => {
			const request = store.put({ id: key, file: value });
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve();
		});
	}

	async remove(key: string): Promise<void> {
		const db = await this.getDB();
		const transaction = db.transaction([this.storeName], "readwrite");
		const store = transaction.objectStore(this.storeName);

		return new Promise((resolve, reject) => {
			const request = store.delete(key);
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve();
		});
	}

	async list(): Promise<string[]> {
		const db = await this.getDB();
		const transaction = db.transaction([this.storeName], "readonly");
		const store = transaction.objectStore(this.storeName);

		return new Promise((resolve, reject) => {
			const request = store.getAllKeys();
			request.onerror = () => reject(request.error);
			request.onsuccess = () =>
				resolve(request.result.map((key) => String(key)));
		});
	}

	async clear(): Promise<void> {
		const db = await this.getDB();
		const transaction = db.transaction([this.storeName], "readwrite");
		const store = transaction.objectStore(this.storeName);

		return new Promise((resolve, reject) => {
			const request = store.clear();
			request.onerror = () => reject(request.error);
			request.onsuccess = () => resolve();
		});
	}
}

function readFileRecord({
	value,
}: {
	value: unknown;
}): IndexedDBFileRecord | null {
	if (
		typeof value !== "object" ||
		value === null ||
		!("id" in value) ||
		!("file" in value)
	) {
		return null;
	}

	const record = value as Record<string, unknown>;
	if (typeof record.id !== "string" || !(record.file instanceof File)) {
		return null;
	}

	return {
		id: record.id,
		file: record.file,
	};
}
