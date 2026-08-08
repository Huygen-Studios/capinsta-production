import { afterEach, describe, expect, test } from "bun:test";
import { OPFSAdapter } from "./opfs-adapter";

const originalNavigator = globalThis.navigator;
const originalWindow = globalThis.window;

function setGlobalProperty({ key, value }: { key: string; value: unknown }) {
	Object.defineProperty(globalThis, key, {
		configurable: true,
		value,
	});
}

function setNavigator(value: unknown) {
	setGlobalProperty({ key: "navigator", value });
}

afterEach(() => {
	setNavigator(originalNavigator);
	setGlobalProperty({ key: "window", value: originalWindow });
});

describe("OPFSAdapter", () => {
	test("reports unsupported when navigator is unavailable", () => {
		setNavigator(undefined);

		expect(OPFSAdapter.isSupported()).toBe(false);
	});

	test("reports unsupported when navigator.storage is unavailable", () => {
		setNavigator({});

		expect(OPFSAdapter.isSupported()).toBe(false);
	});

	test("reports unsupported when getDirectory is unavailable", () => {
		setNavigator({ storage: {} });

		expect(OPFSAdapter.isSupported()).toBe(false);
	});

	test("reports supported when getDirectory is available", () => {
		setGlobalProperty({
			key: "window",
			value: { isSecureContext: true },
		});
		setNavigator({
			storage: {
				getDirectory: async () => ({}),
			},
		});

		expect(OPFSAdapter.isSupported()).toBe(true);
	});
});
