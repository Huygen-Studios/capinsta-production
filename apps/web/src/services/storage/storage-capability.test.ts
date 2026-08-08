import { afterEach, describe, expect, test } from "bun:test";
import {
	MediaStorageUnavailableError,
	assertMediaStorageAvailable,
	getMediaStorageCapability,
	getOPFSStorageCapability,
	getStorageFailureMessage,
	getStorageUnavailableMessage,
} from "./storage-capability";

const originalNavigator = globalThis.navigator;
const originalWindow = globalThis.window;
const originalIndexedDB = globalThis.indexedDB;

function setGlobalProperty({ key, value }: { key: string; value: unknown }) {
	Object.defineProperty(globalThis, key, {
		configurable: true,
		value,
	});
}

function setSecureWindow({ isSecureContext }: { isSecureContext: boolean }) {
	setGlobalProperty({
		key: "window",
		value: { isSecureContext },
	});
}

afterEach(() => {
	setGlobalProperty({ key: "navigator", value: originalNavigator });
	setGlobalProperty({ key: "window", value: originalWindow });
	setGlobalProperty({ key: "indexedDB", value: originalIndexedDB });
});

describe("storage capability detection", () => {
	test("uses OPFS when getDirectory is available in a secure context", () => {
		setSecureWindow({ isSecureContext: true });
		setGlobalProperty({
			key: "navigator",
			value: {
				storage: {
					getDirectory: async () => ({}),
				},
			},
		});

		expect(getOPFSStorageCapability()).toEqual({
			supported: true,
			backend: "opfs",
		});
		expect(getMediaStorageCapability()).toEqual({
			supported: true,
			backend: "opfs",
		});
	});

	test("does not call getDirectory when OPFS is unavailable", () => {
		setSecureWindow({ isSecureContext: true });
		setGlobalProperty({
			key: "navigator",
			value: { storage: {} },
		});
		setGlobalProperty({
			key: "indexedDB",
			value: { open: () => ({}) },
		});

		expect(getOPFSStorageCapability()).toMatchObject({
			supported: false,
			reason: "opfs-unavailable",
		});
		expect(getMediaStorageCapability()).toEqual({
			supported: true,
			backend: "indexeddb",
		});
	});

	test("reports HTTPS guidance for insecure network contexts", () => {
		setSecureWindow({ isSecureContext: false });
		setGlobalProperty({
			key: "navigator",
			value: {
				storage: {
					getDirectory: async () => ({}),
				},
			},
		});
		setGlobalProperty({ key: "indexedDB", value: undefined });

		const capability = getMediaStorageCapability();

		expect(capability).toMatchObject({
			supported: false,
			reason: "insecure-context",
		});
		expect(capability.supported ? "" : capability.message).toContain("HTTPS");
	});

	test("throws a structured unsupported-storage error when no fallback is available", () => {
		setSecureWindow({ isSecureContext: true });
		setGlobalProperty({
			key: "navigator",
			value: { storage: {} },
		});
		setGlobalProperty({ key: "indexedDB", value: undefined });

		expect(() => assertMediaStorageAvailable()).toThrow(
			MediaStorageUnavailableError,
		);
	});
});

describe("storage failure messages", () => {
	test("maps quota failures to a storage-space message", () => {
		const error = new DOMException("Quota exceeded", "QuotaExceededError");

		expect(getStorageFailureMessage({ error })).toBe(
			getStorageUnavailableMessage({ reason: "quota-exceeded" }),
		);
	});

	test("maps blocked storage failures to a site-storage message", () => {
		const error = new DOMException("Blocked", "SecurityError");

		expect(getStorageFailureMessage({ error })).toBe(
			getStorageUnavailableMessage({ reason: "storage-blocked" }),
		);
	});

	test("keeps generic write failures non-misleading", () => {
		expect(
			getStorageFailureMessage({
				error: new Error("write failed"),
			}),
		).toBe("Media could not be saved in this browser.");
	});
});
