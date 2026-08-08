export type StorageCapabilityReason =
	| "insecure-context"
	| "opfs-unavailable"
	| "storage-blocked"
	| "quota-exceeded";

export type StorageBackend = "opfs" | "indexeddb";

export type StorageCapability =
	| { supported: true; backend: StorageBackend }
	| {
			supported: false;
			reason: StorageCapabilityReason;
			message: string;
			cause?: unknown;
	  };

export class MediaStorageUnavailableError extends Error {
	readonly reason: StorageCapabilityReason;
	readonly cause?: unknown;

	constructor({
		reason,
		message,
		cause,
	}: {
		reason: StorageCapabilityReason;
		message: string;
		cause?: unknown;
	}) {
		super(message);
		this.name = "MediaStorageUnavailableError";
		this.reason = reason;
		this.cause = cause;
	}
}

export function getStorageUnavailableMessage({
	reason,
}: {
	reason: StorageCapabilityReason;
}): string {
	if (reason === "insecure-context") {
		return "Media import requires HTTPS when opening the editor from a network address.";
	}
	if (reason === "storage-blocked") {
		return "Your browser blocked local storage for this site. Enable site storage and try again.";
	}
	if (reason === "quota-exceeded") {
		return "Insufficient browser storage space to import this file.";
	}
	return "Local media storage is unavailable in this browser. Use a current browser that supports persistent local storage.";
}

export function getOPFSStorageCapability(): StorageCapability {
	try {
		if (typeof navigator === "undefined") {
			return {
				supported: false,
				reason: "opfs-unavailable",
				message: getStorageUnavailableMessage({ reason: "opfs-unavailable" }),
			};
		}

		if (typeof window !== "undefined" && !window.isSecureContext) {
			return {
				supported: false,
				reason: "insecure-context",
				message: getStorageUnavailableMessage({ reason: "insecure-context" }),
			};
		}

		if (typeof navigator.storage?.getDirectory !== "function") {
			return {
				supported: false,
				reason: "opfs-unavailable",
				message: getStorageUnavailableMessage({ reason: "opfs-unavailable" }),
			};
		}

		return { supported: true, backend: "opfs" };
	} catch (error) {
		return {
			supported: false,
			reason: "storage-blocked",
			message: getStorageUnavailableMessage({ reason: "storage-blocked" }),
			cause: error,
		};
	}
}

export function getIndexedDBStorageCapability(): StorageCapability {
	try {
		if (
			typeof indexedDB === "undefined" ||
			typeof indexedDB.open !== "function"
		) {
			return {
				supported: false,
				reason: "storage-blocked",
				message: getStorageUnavailableMessage({ reason: "storage-blocked" }),
			};
		}

		return { supported: true, backend: "indexeddb" };
	} catch (error) {
		return {
			supported: false,
			reason: "storage-blocked",
			message: getStorageUnavailableMessage({ reason: "storage-blocked" }),
			cause: error,
		};
	}
}

export function getMediaStorageCapability(): StorageCapability {
	const opfsCapability = getOPFSStorageCapability();
	if (opfsCapability.supported) return opfsCapability;

	const indexedDBCapability = getIndexedDBStorageCapability();
	if (indexedDBCapability.supported) return indexedDBCapability;

	return opfsCapability.reason === "insecure-context"
		? opfsCapability
		: indexedDBCapability;
}

export function assertMediaStorageAvailable(): StorageBackend {
	const capability = getMediaStorageCapability();
	if (capability.supported) return capability.backend;

	throw new MediaStorageUnavailableError({
		reason: capability.reason,
		message: capability.message,
		cause: capability.cause,
	});
}

export function getStorageFailureMessage({
	error,
	fallback = "Media could not be saved in this browser.",
}: {
	error: unknown;
	fallback?: string;
}): string {
	if (error instanceof MediaStorageUnavailableError) return error.message;
	if (error instanceof Error) {
		if (
			error.name === "QuotaExceededError" ||
			error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
			error.message.toLowerCase().includes("quota")
		) {
			return getStorageUnavailableMessage({ reason: "quota-exceeded" });
		}
		if (
			error.name === "SecurityError" ||
			error.name === "InvalidStateError" ||
			error.message.toLowerCase().includes("blocked")
		) {
			return getStorageUnavailableMessage({ reason: "storage-blocked" });
		}
	}

	return fallback;
}
