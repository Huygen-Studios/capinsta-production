/* eslint-disable opencut/prefer-object-params, @typescript-eslint/no-unsafe-type-assertion -- Tests inspect FormData boundary objects from mocked fetch calls. */
import { describe, expect, test } from "bun:test";
import {
	checkCapinstaHealth,
	normalizeCapinstaJobToTranscript,
	sendCapinstaProjectHeartbeat,
	startCapinstaCaptionJob,
} from "./apiClient";
import type { CapinstaJobDetailResponse } from "./apiTypes";
import { capinstaTranscriptToCaptionDocument } from "./adapter";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
		...init,
	});
}

describe("Capinsta API client", () => {
	test("handles health check responses", async () => {
		const health = await checkCapinstaHealth({
			baseUrl: "http://127.0.0.1:8000",
			fetchImpl: async (url) => {
				expect(url).toBe("http://127.0.0.1:8000/health/ready");
				return jsonResponse({ status: "ok", version: "5.0.0" });
			},
		});

		expect(health.status).toBe("ok");
	});

	test("creates caption jobs with expected form fields", async () => {
		const file = new File(["video"], "sample.mp4", { type: "video/mp4" });
		const job = await startCapinstaCaptionJob({
			baseUrl: "http://127.0.0.1:8000",
			file,
			projectId: "project-1",
			languageMode: "auto",
			captionOutput: "original",
			fetchImpl: async (url, init) => {
				expect(url).toBe("http://127.0.0.1:8000/api/jobs");
				expect(init?.method).toBe("POST");
				const body = init?.body;
				expect(body).toBeInstanceOf(FormData);
				expect((body as FormData).get("audioLanguage")).toBe("auto");
				expect((body as FormData).get("captionOutput")).toBe("original");
				const uploadedFile = (body as FormData).get("file") as File;
				expect(uploadedFile.name).toBe("sample.mp4");
				expect(uploadedFile.type).toBe("video/mp4");
				return jsonResponse({
					job_id: "job-001",
					status: "queued",
					progress: 0,
					filename: "sample.mp4",
					languageMode: "auto_mixed_indian",
				});
			},
		});

		expect(job.job_id).toBe("job-001");
	});

	test("surfaces proxy upload failures with stage and correlation ID", async () => {
		const file = new File(["video"], "sample.mp4", { type: "video/mp4" });

		await expect(
			startCapinstaCaptionJob({
				baseUrl: "/api/capinsta",
				file,
				projectId: "project-1",
				languageMode: "auto",
				fetchImpl: async () =>
					jsonResponse(
						{
							detail: "The Capinsta backend is temporarily unreachable.",
							code: "backend_unreachable",
							stage: "proxy_connection",
							correlationId: "corr-upload-1",
						},
						{ status: 503 },
					),
			}),
		).rejects.toMatchObject({
			name: "CapinstaApiError",
			message: "The Capinsta backend is temporarily unreachable.",
			status: 503,
			diagnostics: {
				code: "backend_unreachable",
				stage: "proxy_connection",
				correlationId: "corr-upload-1",
			},
		});
	});

	test("surfaces backend request-limit errors from structured error bodies", async () => {
		const file = new File(["video"], "sample.mp4", { type: "video/mp4" });

		await expect(
			startCapinstaCaptionJob({
				baseUrl: "/api/capinsta",
				file,
				projectId: "project-1",
				languageMode: "auto",
				fetchImpl: async () =>
					jsonResponse(
						{
							error: {
								code: "payload_too_large",
								message: "The request is too large.",
								requestId: "req-413",
							},
						},
						{ status: 413 },
					),
			}),
		).rejects.toMatchObject({
			name: "CapinstaApiError",
			message: "The request is too large.",
			status: 413,
			diagnostics: {
				code: "payload_too_large",
				correlationId: "req-413",
			},
		});
	});

	test("creates caption jobs with a media asset id instead of a file", async () => {
		const job = await startCapinstaCaptionJob({
			baseUrl: "http://127.0.0.1:8000",
			mediaAssetId: "server-asset-1",
			projectId: "project-1",
			languageMode: "auto",
			captionOutput: "original",
			fetchImpl: async (_url, init) => {
				const body = init?.body;
				expect(body).toBeInstanceOf(FormData);
				expect((body as FormData).get("media_asset_id")).toBe("server-asset-1");
				expect((body as FormData).has("file")).toBe(false);
				return jsonResponse({
					job_id: "job-001",
					status: "queued",
					progress: 0,
				});
			},
		});

		expect(job.job_id).toBe("job-001");
	});

	test("does not submit an empty caption job", async () => {
		await expect(
			startCapinstaCaptionJob({
				baseUrl: "http://127.0.0.1:8000",
				projectId: "project-1",
				languageMode: "auto",
				fetchImpl: async () => {
					throw new Error("should not call fetch");
				},
			}),
		).rejects.toThrow("Caption media is unavailable");
	});

	test("does not submit a caption job when file is not a real Blob", async () => {
		await expect(
			startCapinstaCaptionJob({
				baseUrl: "http://127.0.0.1:8000",
				file: { name: "video.mp4", size: 10, type: "video/mp4" } as File,
				projectId: "project-1",
				languageMode: "auto",
				fetchImpl: async () => {
					throw new Error("should not call fetch");
				},
			}),
		).rejects.toThrow("Caption media is unavailable");
	});

	test("normalizes completed jobs into CapinstaTranscriptV1", () => {
		const job: CapinstaJobDetailResponse = {
			job_id: "job-001",
			status: "completed",
			progress: 100,
			filename: "sample.mp4",
			languageMode: "english",
			transcript: {
				languageMode: "english",
				provider: { name: "sarvam", model: "saaras:v3" },
				segments: [
					{
						id: "seg-1",
						start: 0.2,
						end: 1.3,
						text: "Hello world",
						words: [
							{
								word: "Hello",
								displayedWord: "Hello",
								start: 0.2,
								end: 0.7,
								timingSource: "provider",
							},
							{
								word: "world",
								displayedWord: "world",
								start: 0.75,
								end: 1.3,
								timingSource: "stable_ts",
								timingNeedsReview: true,
							},
						],
					},
				],
				metadata: {
					audio: { duration: 2 },
					timing: { source: "test" },
				},
			},
			completed_at: "2026-06-15T00:00:00.000Z",
		};

		const transcript = normalizeCapinstaJobToTranscript({
			job,
			sourceAsset: {
				assetId: "asset-001",
				assetName: "sample.mp4",
				mimeType: "video/mp4",
			},
		});

		expect(transcript.version).toBe("capinsta.transcript.v1");
		expect(transcript.provider.name).toBe("sarvam");
		expect(transcript.clips).toHaveLength(1);
		expect(transcript.words).toHaveLength(2);
		expect(transcript.words[1]?.timingSource).toBe("stable_ts");
		expect(transcript.clips[0]?.timingNeedsReview).toBe(true);
	});

	test("normalizes phrase fallback jobs without timed words", () => {
		const job: CapinstaJobDetailResponse = {
			job_id: "job-phrase",
			status: "completed",
			progress: 100,
			filename: "phrase.mp4",
			languageMode: "english",
			transcript: {
				languageMode: "english",
				provider: { name: "sarvam", model: "saaras:v3" },
				segments: [
					{
						id: "phrase-1",
						start: 0.4,
						end: 1.8,
						text: "provider phrase only",
						words: [],
						disableActiveWordHighlighting: true,
						timingNeedsReview: true,
					},
				],
				metadata: {
					audio: { duration: 2 },
					timing: { source: "test" },
				},
			},
			completed_at: "2026-06-15T00:00:00.000Z",
		};

		const transcript = normalizeCapinstaJobToTranscript({
			job,
			sourceAsset: {
				assetId: "asset-phrase",
				assetName: "phrase.mp4",
				mimeType: "video/mp4",
			},
		});
		const document = capinstaTranscriptToCaptionDocument(transcript);

		expect(transcript.timing.sourceOfTruth).toBe("clips");
		expect(transcript.words).toHaveLength(0);
		expect(transcript.clips[0]?.disableActiveWordHighlighting).toBe(true);
		expect(document.clips[0]?.disableActiveWordHighlighting).toBe(true);
	});

	test("normalizes one hundred percent estimated timing responses into timeline captions", () => {
		const job: CapinstaJobDetailResponse = {
			job_id: "job-estimated",
			status: "completed",
			progress: 100,
			filename: "estimated.mp4",
			languageMode: "english",
			transcript: {
				languageMode: "english",
				provider: { name: "openai_whisper", model: "whisper-1" },
				segments: [
					{
						id: "estimated-1",
						start: 0,
						end: 1.2,
						text: "All estimated",
						words: [
							{ word: "All", displayedWord: "All", start: 0, end: 0.5, timingSource: "estimated", timingNeedsReview: true },
							{ word: "estimated", displayedWord: "estimated", start: 0.5, end: 1.2, timingSource: "estimated", timingNeedsReview: true },
						],
					},
				],
				metadata: {
					audio: { duration: 1.2 },
					timing: {
						report: {
							finalTimingQuality: {
								passed: true,
								totalWords: 2,
								estimatedWordCount: 2,
								estimatedWordRatio: 1,
								failures: [],
							},
						},
					},
				},
			},
			completed_at: "2026-06-15T00:00:00.000Z",
		};

		const transcript = normalizeCapinstaJobToTranscript({
			job,
			sourceAsset: {
				assetId: "asset-estimated",
				assetName: "estimated.mp4",
				mimeType: "video/mp4",
			},
		});
		const document = capinstaTranscriptToCaptionDocument(transcript);

		expect(transcript.words).toHaveLength(2);
		expect(document.clips.length).toBeGreaterThan(0);
		expect(document.clips.map((clip) => clip.text).join(" ")).toContain("All estimated");
		expect(document.words.every((word) => word.timingNeedsReview)).toBe(true);
	});

	test("renews the backend project lease", async () => {
		const lease = await sendCapinstaProjectHeartbeat({
			baseUrl: "http://127.0.0.1:8000",
			jobId: "job-001",
			fetchImpl: async (url, init) => {
				expect(url).toBe("http://127.0.0.1:8000/api/jobs/job-001/heartbeat");
				expect(init?.method).toBe("POST");
				return jsonResponse({
					job_id: "job-001",
					last_seen_at: "2026-06-19T10:00:00+00:00",
					expires_at: "2026-06-19T10:15:00+00:00",
				});
			},
		});

		expect(lease.expires_at).toBe("2026-06-19T10:15:00+00:00");
	});

	test("prefers canonical alignedWords without redistributing pause timing", () => {
		const job: CapinstaJobDetailResponse = {
			job_id: "job-pause",
			status: "completed",
			progress: 100,
			filename: "pause.mp4",
			languageMode: "english",
			transcript: {
				languageMode: "english",
				provider: "sarvam",
				alignedWords: [
					{
						word: "spends",
						displayedWord: "spends",
						originalWord: "spends",
						spokenWord: "spends",
						start: 0.5,
						end: 0.9,
						timing_source: "provider_word",
					},
					{
						word: "around",
						displayedWord: "around",
						start: 0.9,
						end: 1.2,
						timingSource: "vad_adjusted",
						timingSourceDetail: "provider_word | pause_preserved",
					},
					{
						word: "22",
						displayedWord: "22",
						start: 2.4,
						end: 2.65,
						timing_source: "pause_preserved",
						timingWarning: "Adjusted to detected speech after silence.",
					},
					{ word: "lakh", displayedWord: "lakh", start: 2.66, end: 2.9 },
					{ word: "crore", displayedWord: "crore", start: 2.91, end: 3.2 },
				],
				segments: [
					{
						id: "compressed-segment",
						start: 0.5,
						end: 3.2,
						text: "spends around 22 lakh crore",
						words: [
							{ word: "spends", start: 0.5, end: 1.0 },
							{ word: "around", start: 1.0, end: 1.5 },
							{ word: "22", start: 1.5, end: 1.8 },
							{ word: "lakh", start: 1.8, end: 2.1 },
							{ word: "crore", start: 2.1, end: 2.4 },
						],
					},
				],
				metadata: {
					audio: { duration: 3.5 },
					timing: {
						vad: {
							silenceGaps: [{ start: 1.2, end: 2.4, duration: 1.2 }],
						},
					},
					sync: {
						pausePreservation: {
							pauseGapsApplied: 1,
							wordsShiftedForPause: 3,
							wordsClampedForPause: 0,
						},
					},
				},
			},
		};

		const transcript = normalizeCapinstaJobToTranscript({
			job,
			sourceAsset: {
				assetId: "asset-pause",
				assetName: "pause.mp4",
				mimeType: "video/mp4",
			},
		});

		expect(transcript.words.map((word) => word.start)).toEqual([
			0.5, 0.9, 2.4, 2.66, 2.91,
		]);
		expect(transcript.words[1]?.timingSourceDetail).toBe(
			"provider_word | pause_preserved",
		);
		expect(transcript.words[2]?.timingWarning).toBe(
			"Adjusted to detected speech after silence.",
		);
		expect(transcript.timing.silenceGaps).toEqual([
			{ start: 1.2, end: 2.4, duration: 1.2 },
		]);
		expect(transcript.timing.sync?.pausePreservation).toEqual({
			pauseGapsApplied: 1,
			wordsShiftedForPause: 3,
			wordsClampedForPause: 0,
		});
		const document = capinstaTranscriptToCaptionDocument(transcript);
		expect(document.clips.map((clip) => clip.text)).toEqual([
			"spends around",
			"22 lakh crore",
		]);
	});
});
