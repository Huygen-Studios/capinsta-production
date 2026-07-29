/* eslint-disable @typescript-eslint/no-unsafe-type-assertion, opencut/prefer-object-params -- Synthetic File doubles avoid allocating a 480 MB test buffer. */
import { describe, expect, test } from "bun:test";
import { parseCandidates, uploadTusForTest, viralCandidateSchema } from "./api";

const candidate = {
	candidateId: "candidate_001",
	sourceStartMs: 20_000,
	sourceEndMs: 50_000,
	durationMs: 30_000,
	title: "A specific payoff",
	hookText: "Watch what changes",
	supportingEmojis: ["👨🏽‍💻", "✨"],
	viralScore: 82,
	scoreBreakdown: {
		hookStrength: 18,
		clarity: 17,
		payoff: 17,
		emotion: 14,
		novelty: 16,
	},
	reason: "A concise setup with a clear result.",
	transcriptEvidence: {
		wordIds: ["word_001"],
		segmentIds: ["seg_001"],
		excerpt: "Synthetic transcript excerpt.",
	},
	recommendedFramingStrategy: "single_subject_crop",
	recommendedCaptionPreset: "word_highlight_box",
	warnings: [],
	status: "proposed",
	projectRevision: 1,
	selectedProjectRevision: null,
} as const;

describe("automatic clipper API contracts", () => {
	test("accepts bounded candidates and preserves multi-codepoint emoji", () => {
		const parsed = parseCandidates([candidate]);
		expect(parsed[0]?.supportingEmojis).toEqual(["👨🏽‍💻", "✨"]);
		expect(parsed[0]?.durationMs).toBe(30_000);
	});

	test("rejects inconsistent timing, scores, and emoji spam at runtime", () => {
		expect(() =>
			viralCandidateSchema.parse({
				...candidate,
				durationMs: 29_000,
				viralScore: 101,
				supportingEmojis: ["1", "2", "3"],
			}),
		).toThrow();
	});

	test("rejects untrusted response fields and invalid layout values", () => {
		expect(() =>
			viralCandidateSchema.parse({
				...candidate,
				recommendedFramingStrategy: "arbitrary_layout",
				providerSecret: "must-not-cross-boundary",
			}),
		).toThrow();
	});

	test("creates Supabase TUS uploads without POST body and PATCHes every byte", async () => {
		const requests: RequestInit[] = [];
		const file = {
			size: 480_531_086,
			slice: (start: number, end: number) => ({ size: end - start, start, end }),
		} as unknown as File;
		const fetchImpl = async (_url: RequestInfo | URL, init?: RequestInit) => {
			requests.push(init ?? {});
			if (init?.method === "POST") {
				return new Response("", {
					status: 201,
					headers: { location: "https://storage.invalid/upload/1", "upload-offset": "0" },
				});
			}
			const headers = new Headers(init?.headers);
			const offset = Number(headers.get("Upload-Offset"));
			const bodySize = Number((init?.body as { size?: number } | undefined)?.size ?? 0);
			return new Response("", {
				status: 204,
				headers: { "upload-offset": String(offset + bodySize) },
			});
		};

		await uploadTusForTest({
			file,
			instructions: {
				mediaAssetId: "media-1",
				uploadSessionId: "upload-1",
				uploadUrl: "https://storage.invalid/storage/v1/upload/resumable",
				requiredHeaders: { "x-signature": "signed", "x-upsert": "false" },
				uploadMetadata: {
					bucketName: "source-media",
					objectName: "owner/media/source/v1.mp4",
					contentType: "video/mp4",
					cacheControl: "3600",
				},
			},
			tusAuthHeaders: { apikey: "anon", authorization: "Bearer user" },
			onProgress: () => {},
			fetchImpl: fetchImpl as typeof fetch,
		});

		const create = requests[0]!;
		expect(create.method).toBe("POST");
		expect(create.body).toBeUndefined();
		const createHeaders = new Headers(create.headers);
		expect(createHeaders.get("Upload-Length")).toBe("480531086");
		expect(createHeaders.get("Upload-Metadata")).toContain("bucketName");
		expect(createHeaders.get("x-signature")).toBe("signed");
		expect(createHeaders.get("authorization")).toBe("Bearer user");

		const patches = requests.slice(1);
		expect(patches[0]?.method).toBe("PATCH");
		expect(new Headers(patches[0]?.headers).get("Upload-Offset")).toBe("0");
		expect((patches[0]?.body as { size: number }).size).toBe(5_000_000);
		expect((patches.at(-1)?.body as { size: number }).size).toBe(531_086);
		const uploadedBytes = patches.reduce(
			(total, request) => total + (request.body as { size: number }).size,
			0,
		);
		expect(uploadedBytes).toBe(480_531_086);
	});

	test("resumes through HEAD and maps creation 413 safely", async () => {
		const file = {
			size: 10_000_001,
			slice: (start: number, end: number) => ({ size: end - start, start, end }),
		} as unknown as File;
		const resumed: RequestInit[] = [];
		await uploadTusForTest({
			file,
			instructions: {
				mediaAssetId: "media-1",
				uploadSessionId: "upload-1",
				uploadUrl: "https://storage.invalid/storage/v1/upload/resumable",
				uploadLocation: "https://storage.invalid/upload/1",
				requiredHeaders: { "x-signature": "signed" },
				uploadMetadata: {},
			},
			tusAuthHeaders: {},
			onProgress: () => {},
			fetchImpl: (async (_url, init) => {
				resumed.push(init ?? {});
				if (init?.method === "HEAD")
					return new Response("", { status: 200, headers: { "upload-offset": "5" } });
				const headers = new Headers(init?.headers);
				const offset = Number(headers.get("Upload-Offset"));
				const bodySize = Number((init?.body as { size?: number } | undefined)?.size ?? 0);
				return new Response("", {
					status: 204,
					headers: { "upload-offset": String(offset + bodySize) },
				});
			}) as typeof fetch,
		});
		expect(resumed[0]?.method).toBe("HEAD");
		expect(new Headers(resumed[1]?.headers).get("Upload-Offset")).toBe("5");

		await expect(
			uploadTusForTest({
				file,
				instructions: {
					mediaAssetId: "media-1",
					uploadSessionId: "upload-1",
					uploadUrl: "https://storage.invalid/storage/v1/upload/resumable",
					requiredHeaders: {},
					uploadMetadata: {},
				},
				tusAuthHeaders: {},
				onProgress: () => {},
				fetchImpl: (async () =>
					new Response("EntityTooLarge", {
						status: 413,
						headers: { "sb-request-id": "req-413" },
					})) as typeof fetch,
			}),
		).rejects.toThrow("Video exceeds the Storage limit");
	});
});
