import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import type { CapInstaRemotionPropsV1 } from "./contracts";
import { expectsAudio, metadataForProps } from "./contracts";

const execFileAsync = promisify(execFile);

export type OutputVerification = {
	codec: string;
	pixelFormat: string;
	pixelFormatContractValid: boolean;
	width: number;
	height: number;
	fps: number;
	frameCount: number | null;
	durationSeconds: number;
	audioCodec: string | null;
	videoBitrate: number | null;
	audioBitrate: number | null;
	formatBitrate: number | null;
	encoder: string | null;
	bytes: number;
};

function fraction(value: string | undefined): number {
	const parts = String(value ?? "0").split("/");
	const numerator = Number(parts[0]);
	const denominator = Number(parts[1] ?? 1);
	return denominator ? numerator / denominator : 0;
}

export async function verifyOutput(output: string, props: CapInstaRemotionPropsV1, { allowYuvj420p = false } = {}): Promise<OutputVerification> {
	const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", output], { maxBuffer: 4 * 1024 * 1024 });
	const probe = JSON.parse(stdout) as { streams?: Array<Record<string, string>>; format?: Record<string, string> };
	const video = probe.streams?.find((stream) => stream.codec_type === "video");
	const audio = probe.streams?.find((stream) => stream.codec_type === "audio");
	const expected = metadataForProps(props);
	const durationSeconds = Number(video?.duration ?? probe.format?.duration ?? 0);
	const fps = fraction(video?.avg_frame_rate);
	const expectedDuration = expected.durationInFrames / expected.fps;
	const pixelFormatContractValid = video?.pix_fmt === "yuv420p";
	if (!video || video.codec_name !== "h264" || (!pixelFormatContractValid && !(allowYuvj420p && video.pix_fmt === "yuvj420p")) || Number(video.width) !== expected.width || Number(video.height) !== expected.height || Math.abs(fps - expected.fps) > 0.001 || Math.abs(durationSeconds - expectedDuration) > 1 / expected.fps + 0.02 || (expectsAudio(props) && !audio)) {
		throw new Error("OUTPUT_INVALID: FFprobe output does not match the requested composition");
	}
	return {
		codec: video.codec_name,
		pixelFormat: video.pix_fmt,
		pixelFormatContractValid,
		width: Number(video.width),
		height: Number(video.height),
		fps,
		frameCount: video.nb_frames ? Number(video.nb_frames) : null,
		durationSeconds,
		audioCodec: audio?.codec_name ?? null,
		videoBitrate: video.bit_rate ? Number(video.bit_rate) : null,
		audioBitrate: audio?.bit_rate ? Number(audio.bit_rate) : null,
		formatBitrate: probe.format?.bit_rate ? Number(probe.format.bit_rate) : null,
		encoder: video.tags && typeof video.tags === "object" ? String((video.tags as Record<string, string>).encoder ?? "") || null : null,
		bytes: (await stat(output)).size,
	};
}
