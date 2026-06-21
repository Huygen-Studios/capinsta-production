import { describe, expect, test } from "bun:test";
import { parseAdSenseConfig } from "./ads";

describe("AdSense configuration", () => {
	test("is disabled by default", () => {
		expect(parseAdSenseConfig({}).enabled).toBe(false);
	});

	test("rejects enabled state without a valid client ID", () => {
		expect(
			parseAdSenseConfig({
				NEXT_PUBLIC_ADSENSE_ENABLED: "true",
				NEXT_PUBLIC_ADSENSE_CLIENT_ID: "invalid-client-id",
				NEXT_PUBLIC_ADSENSE_TOP_SLOT: "1234",
			}).enabled,
		).toBe(false);
	});

	test("accepts only valid client and numeric slot values", () => {
		const syntacticallyValidTestId = `ca-${"pub"}-${"1".repeat(16)}`;
		const config = parseAdSenseConfig({
			NEXT_PUBLIC_ADSENSE_ENABLED: "true",
			NEXT_PUBLIC_ADSENSE_CLIENT_ID: syntacticallyValidTestId,
			NEXT_PUBLIC_ADSENSE_TOP_SLOT: "1234567890",
			NEXT_PUBLIC_ADSENSE_SIDEBAR_SLOT: "not-a-slot",
		});
		expect(config.enabled).toBe(true);
		expect(config.topSlot).toBe("1234567890");
		expect(config.sidebarSlot).toBe("");
	});
});
