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

const { uploadProjectMediaAsset } = await import("./mediaAssetApi");

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
			message: "The media service is temporarily unavailable.",
			status: 503,
			code: "backend_unreachable",
			correlationId: "corr-1",
		});
	});
});
