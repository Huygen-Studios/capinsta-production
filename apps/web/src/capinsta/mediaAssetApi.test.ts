import { beforeEach, describe, expect, mock, test } from "bun:test";

const authenticatedFetchMock = mock(
	async (_input: RequestInfo | URL, _init?: RequestInit) =>
		new Response(
			JSON.stringify({
				assetId: "asset-1",
				downloadUrl: "/api/media/assets/asset-1/content",
				sizeBytes: 12,
			}),
			{ status: 200, headers: { "content-type": "application/json" } },
		),
);

mock.module("@/lib/supabase/authenticated-fetch", () => ({
	authenticatedFetch: authenticatedFetchMock,
}));

const { messageForMediaFailure, uploadProjectMediaAsset } =
	await import("./mediaAssetApi");

describe("media asset API", () => {
	beforeEach(() => {
		authenticatedFetchMock.mockClear();
		authenticatedFetchMock.mockImplementation(
			async (_input: RequestInfo | URL, _init?: RequestInit) =>
				new Response(
					JSON.stringify({
						assetId: "asset-1",
						downloadUrl: "/api/media/assets/asset-1/content",
						sizeBytes: 12,
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		);
	});

	test("creates the expected authenticated multipart media upload request", async () => {
		const file = new File(["hello"], "sample.webm", { type: "audio/webm" });
		await uploadProjectMediaAsset({ projectId: "project-1", file });

		expect(authenticatedFetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = authenticatedFetchMock.mock.calls[0] ?? [];
		expect(String(url)).toBe("/api/capinsta/api/media/assets");
		expect(init?.method).toBe("POST");
		const body = init?.body;
		expect(body).toBeInstanceOf(FormData);
		if (!(body instanceof FormData)) {
			throw new Error("Expected FormData request body.");
		}
		const formData = body;
		expect(formData.get("project_id")).toBe("project-1");
		const uploadedFile = formData.get("file");
		expect(uploadedFile).toBeInstanceOf(File);
		if (!(uploadedFile instanceof File)) {
			throw new Error("Expected uploaded file in request body.");
		}
		expect(uploadedFile.name).toBe(file.name);
		expect(uploadedFile.type).toBe(file.type);
		expect(await uploadedFile.text()).toBe("hello");
		expect(new Headers(init?.headers).has("content-type")).toBe(false);
	});

	test("uploads large media through bounded chunks", async () => {
		authenticatedFetchMock
			.mockImplementationOnce(async () =>
				Response.json({ uploadId: "upload-1", chunkSize: 5 * 1024 * 1024 }),
			)
			.mockImplementationOnce(async () =>
				Response.json({ uploadId: "upload-1", offset: 5 * 1024 * 1024 }),
			)
			.mockImplementationOnce(async () =>
				Response.json({ uploadId: "upload-1", offset: 5 * 1024 * 1024 + 1 }),
			)
			.mockImplementationOnce(async () =>
				Response.json({
					assetId: "asset-large",
					downloadUrl: "/api/media/assets/asset-large/content",
					sizeBytes: 5 * 1024 * 1024 + 1,
				}),
			);
		const file = new File(
			[new Uint8Array(5 * 1024 * 1024 + 1)],
			"large-video.mp4",
			{ type: "video/mp4" },
		);

		const result = await uploadProjectMediaAsset({
			projectId: "project-1",
			file,
		});

		expect(result.assetId).toBe("asset-large");
		expect(authenticatedFetchMock).toHaveBeenCalledTimes(4);
		const [, firstChunkInit] = authenticatedFetchMock.mock.calls[1] ?? [];
		expect(firstChunkInit?.method).toBe("PUT");
		expect(firstChunkInit?.body).toBeInstanceOf(Blob);
		expect(new Headers(firstChunkInit?.headers).get("x-upload-offset")).toBe(
			"0",
		);
		const [, secondChunkInit] = authenticatedFetchMock.mock.calls[2] ?? [];
		expect(new Headers(secondChunkInit?.headers).get("x-upload-offset")).toBe(
			(5 * 1024 * 1024).toString(),
		);
	});

	test("maps proxy failures to actionable media upload errors", async () => {
		authenticatedFetchMock.mockImplementationOnce(async () =>
			Response.json(
				{
					code: "backend_unreachable",
					correlationId: "corr-1",
					detail: "The Capinsta backend is temporarily unreachable.",
				},
				{ status: 503 },
			),
		);

		await expect(
			uploadProjectMediaAsset({
				projectId: "project-1",
				file: new File(["hello"], "sample.webm", { type: "audio/webm" }),
			}),
		).rejects.toMatchObject({
			name: "MediaUploadError",
			message: "The Capinsta backend is temporarily unreachable.",
			status: 503,
			code: "backend_unreachable",
			correlationId: "corr-1",
		});
	});

	test("parses structured FastAPI media upload errors", async () => {
		authenticatedFetchMock.mockImplementationOnce(async () =>
			Response.json(
				{
					detail: {
						message: "Upload a supported video file.",
						code: "UPLOAD_TYPE_NOT_ALLOWED",
						diagnosticId: "corr-structured-1",
					},
				},
				{ status: 415 },
			),
		);

		await expect(
			uploadProjectMediaAsset({
				projectId: "project-1",
				file: new File(["hello"], "sample.bin", {
					type: "application/octet-stream",
				}),
			}),
		).rejects.toMatchObject({
			name: "MediaUploadError",
			message: "Upload a supported video file.",
			status: 415,
			code: "UPLOAD_TYPE_NOT_ALLOWED",
			correlationId: "corr-structured-1",
		});
	});

	test("parses the backend error envelope without mislabeling duration as size", async () => {
		authenticatedFetchMock.mockImplementationOnce(async () =>
			Response.json(
				{
					error: {
						code: "media_duration_exceeded",
						message: "Media duration exceeds the technical limit.",
						requestId: "corr-envelope-1",
						actual: 601,
						allowed: 600,
					},
				},
				{ status: 422 },
			),
		);

		await expect(
			uploadProjectMediaAsset({
				projectId: "project-1",
				file: new File(["hello"], "sample.webm", { type: "video/webm" }),
			}),
		).rejects.toMatchObject({
			name: "MediaUploadError",
			message: "Media duration exceeds the technical limit.",
			status: 422,
			code: "media_duration_exceeded",
			correlationId: "corr-envelope-1",
		});
	});

	test("rejects successful uploads that do not return a media asset id", async () => {
		authenticatedFetchMock.mockImplementationOnce(async () =>
			Response.json({ downloadUrl: "/missing-id", sizeBytes: 12 }),
		);

		await expect(
			uploadProjectMediaAsset({
				projectId: "project-1",
				file: new File(["hello"], "sample.webm", { type: "video/webm" }),
			}),
		).rejects.toMatchObject({
			name: "MediaUploadError",
			code: "media_asset_id_missing",
		});
	});

	test("distinguishes upload bytes from duration and metadata failures", () => {
		expect(
			messageForMediaFailure({
				status: 413,
				code: "upload_too_large",
				fallback: "",
			}),
		).toBe("This file exceeds the current upload-size limit.");
		expect(
			messageForMediaFailure({
				status: 422,
				code: "media_duration_exceeded",
				fallback: "",
			}),
		).toBe("This media exceeds the technical duration limit.");
		expect(
			messageForMediaFailure({
				status: 422,
				code: "invalid_media_metadata",
				fallback: "",
			}),
		).toBe("The media duration could not be determined.");
	});

	test("preserves the backend's actionable duration message", () => {
		expect(
			messageForMediaFailure({
				status: 422,
				code: "caption_duration_limit_exceeded",
				fallback:
					"This video is 197 seconds. Your current caption limit is 180 seconds.",
			}),
		).toBe(
			"This video is 197 seconds. Your current caption limit is 180 seconds.",
		);
	});
});
