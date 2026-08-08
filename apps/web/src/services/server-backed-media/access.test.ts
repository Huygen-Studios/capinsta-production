import { describe, expect, test } from "bun:test";
import {
	parseMediaAccessResponse,
	ServerBackedMediaAccessResolver,
} from "./access";

const ID = "11111111-1111-4111-8111-111111111111";
const descriptor = {
	schemaVersion: 1 as const,
	mediaId: ID,
	mediaAssetId: ID,
	sourceType: "server-backed" as const,
	mediaKind: "video" as const,
	mimeType: "video/mp4",
	displayName: "source.mp4",
	sizeBytes: 3,
	durationMs: 1000,
	width: 100,
	height: 100,
	storageProvider: "supabase" as const,
	accessMode: "authenticated-server-backed" as const,
	requiresBrowserPersistence: false as const,
};

describe("server-backed media access", () => {
	test("accepts the UTC offset emitted by the Python API", () => {
		expect(
			parseMediaAccessResponse({
				mediaAssetId: ID,
				mediaId: ID,
				accessMode: "signed-url",
				url: "https://storage.invalid/object?token=ephemeral",
				expiresAt: "2026-08-03T12:00:00+00:00",
				mimeType: "video/mp4",
				sizeBytes: 3,
				durationMs: 1000,
			}).expiresAt,
		).toBe("2026-08-03T12:00:00+00:00");
	});

	test("deduplicates access without downloading the media object", async () => {
		let accessCalls = 0;
		const resolver = new ServerBackedMediaAccessResolver(async () => {
			accessCalls += 1;
			return {
				mediaAssetId: ID,
				mediaId: ID,
				accessMode: "signed-url",
				url: "https://storage.invalid/object?token=ephemeral",
				expiresAt: new Date(Date.now() + 300_000).toISOString(),
				mimeType: "video/mp4",
				sizeBytes: 3,
				durationMs: 1000,
			};
		});
		const [first, second] = await Promise.all([
			resolver.materializeFile({ descriptor }),
			resolver.materializeFile({ descriptor }),
		]);
		expect(accessCalls).toBe(1);
		expect(first.url).toBe("https://storage.invalid/object?token=ephemeral");
		expect(second.url).toBe(first.url);
		expect(first.file.size).toBe(0);
		resolver.clear();
	});

	test("refreshes access inside the expiry safety window", async () => {
		let calls = 0;
		const resolver = new ServerBackedMediaAccessResolver(async () => ({
			mediaAssetId: ID,
			mediaId: ID,
			accessMode: "signed-url",
			url: `https://storage.invalid/${++calls}`,
			expiresAt: new Date(Date.now() + 30_000).toISOString(),
			mimeType: null,
			sizeBytes: null,
			durationMs: 1000,
		}));
		await resolver.resolve({ mediaAssetId: ID });
		await resolver.resolve({ mediaAssetId: ID });
		expect(calls).toBe(2);
	});
});
