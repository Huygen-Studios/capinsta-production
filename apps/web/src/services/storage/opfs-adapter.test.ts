import { afterEach, describe, expect, test } from "bun:test";
import { OPFSAdapter } from "./opfs-adapter";

const originalNavigator = globalThis.navigator;

function setNavigator(value: unknown) {
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value,
	});
}

afterEach(() => {
	setNavigator(originalNavigator);
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
		setNavigator({
			storage: {
				getDirectory: async () => ({}),
			},
		});

		expect(OPFSAdapter.isSupported()).toBe(true);
	});
});
