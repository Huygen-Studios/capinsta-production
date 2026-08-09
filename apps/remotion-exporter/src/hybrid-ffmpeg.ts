import type { CapInstaRemotionPropsV1 } from "./contracts";

export type HybridBaseVisual =
	| { type: "video" }
	| { type: "solidColor"; color: string };

export type OverlayTransport =
	| { type: "none" }
	| { type: "png"; pattern: string }
	| { type: "prores"; path: string };

const seconds = (milliseconds: number) => (milliseconds / 1000).toFixed(6);

export function atempoChain(rate: number): string[] {
	if (!(rate > 0)) throw new Error("Playback rate must be positive");
	const filters: string[] = [];
	let remaining = rate;
	while (remaining > 2) {
		filters.push("atempo=2");
		remaining /= 2;
	}
	while (remaining < 0.5) {
		filters.push("atempo=0.5");
		remaining /= 0.5;
	}
	if (Math.abs(remaining - 2) < 1e-9) filters.push("atempo=2");
	else if (Math.abs(remaining - 0.5) < 1e-9) filters.push("atempo=0.5");
	else if (Math.abs(remaining - 1) > 1e-9) filters.push(`atempo=${remaining.toFixed(8)}`);
	return filters;
}

export function buildHybridFfmpegArgs({
	props,
	base,
	sourceFiles,
	overlay,
	output,
	preset = "veryfast",
	threads = null,
	seekInputs = false,
}: {
	props: CapInstaRemotionPropsV1;
	base: HybridBaseVisual;
	sourceFiles: ReadonlyMap<string, string>;
	overlay: OverlayTransport;
	output: string;
	preset?: "faster" | "veryfast" | "superfast";
	threads?: 1 | 2 | null;
	seekInputs?: boolean;
}): string[] {
	const { width, height, fps } = props.export;
	const durationSeconds = props.timeline.edl.outputDurationMs / 1000;
	const frames = Math.max(1, Math.round(durationSeconds * fps));
	const args = ["-hide_banner", "-benchmark", "-progress", "pipe:1", "-nostats", "-y"];
	let inputCount = 0;
	const entryInputIndexes = props.timeline.edl.entries.map((entry) => {
		const source = props.media.sources.find((candidate) => candidate.id === entry.sourceMediaId)!;
		if (base.type === "solidColor" && (!source.hasAudio || source.muted)) return null;
		const path = sourceFiles.get(entry.sourceMediaId);
		if (!path) throw new Error(`Missing local source file ${entry.sourceMediaId}`);
		if (seekInputs) args.push("-ss", seconds(entry.sourceStartMs), "-t", seconds(entry.sourceEndMs - entry.sourceStartMs));
		args.push("-i", path);
		return inputCount++;
	});

	let solidInput: number | null = null;
	if (base.type === "solidColor") {
		if (!/^#[0-9a-f]{6}$/i.test(base.color)) throw new Error("Solid base color must be #RRGGBB");
		solidInput = inputCount++;
		args.push("-f", "lavfi", "-i", `color=c=${base.color}:s=${width}x${height}:r=${fps}:d=${durationSeconds.toFixed(6)}`);
	}

	let overlayInput: number | null = null;
	if (overlay.type !== "none") {
		overlayInput = inputCount;
		if (overlay.type === "png") args.push("-framerate", String(fps), "-start_number", "0", "-i", overlay.pattern);
		else args.push("-i", overlay.path);
	}

	const filters: string[] = [];
	let baseLabel: string;
	if (base.type === "video") {
		const videoLabels = props.timeline.edl.entries.map((entry, index) => {
			const input = entryInputIndexes[index];
			if (input === null) throw new Error(`Video base requires source ${entry.sourceMediaId}`);
			const label = `v${index}`;
			filters.push(
				`[${input}:v]trim=start=${seconds(seekInputs ? 0 : entry.sourceStartMs)}:end=${seconds(seekInputs ? entry.sourceEndMs - entry.sourceStartMs : entry.sourceEndMs)},setpts=(PTS-STARTPTS)/${entry.playbackRate.toFixed(8)},scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1[${label}]`,
			);
			return `[${label}]`;
		});
		if (videoLabels.length === 1) baseLabel = "v0";
		else {
			filters.push(`${videoLabels.join("")}concat=n=${videoLabels.length}:v=1:a=0[basev]`);
			baseLabel = "basev";
		}
	} else {
		baseLabel = `solidv`;
		filters.push(`[${solidInput}:v]setpts=PTS-STARTPTS[${baseLabel}]`);
	}

	const expectsAudio = props.timeline.edl.entries.some((entry) => {
		const source = props.media.sources.find((candidate) => candidate.id === entry.sourceMediaId);
		return source?.hasAudio && !source.muted;
	});
	let audioLabel: string | null = null;
	if (expectsAudio) {
		const audioLabels = props.timeline.edl.entries.map((entry, index) => {
			const source = props.media.sources.find((candidate) => candidate.id === entry.sourceMediaId)!;
			const label = `a${index}`;
			if (source.hasAudio && !source.muted) {
				const input = entryInputIndexes[index];
				if (input === null) throw new Error(`Audio input missing for source ${entry.sourceMediaId}`);
				const chain = atempoChain(entry.playbackRate);
				filters.push(`[${input}:a]atrim=start=${seconds(seekInputs ? 0 : entry.sourceStartMs)}:end=${seconds(seekInputs ? entry.sourceEndMs - entry.sourceStartMs : entry.sourceEndMs)},asetpts=PTS-STARTPTS${chain.length ? `,${chain.join(",")}` : ""}[${label}]`);
			} else {
				filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${seconds(entry.outputDurationMs)}[${label}]`);
			}
			return `[${label}]`;
		});
		if (audioLabels.length === 1) audioLabel = "a0";
		else {
			filters.push(`${audioLabels.join("")}concat=n=${audioLabels.length}:v=0:a=1[outa]`);
			audioLabel = "outa";
		}
	}

	let videoLabel = baseLabel;
	if (overlayInput !== null) {
		filters.push(`[${baseLabel}][${overlayInput}:v]overlay=x=0:y=0:alpha=straight:eof_action=endall:shortest=1[outv]`);
		videoLabel = "outv";
	}
	args.push("-filter_complex", filters.join(";"), "-map", `[${videoLabel}]`);
	if (audioLabel) args.push("-map", `[${audioLabel}]`);
	args.push(
		"-frames:v", String(frames), "-r", String(fps),
		"-c:v", "libx264", "-preset", preset, "-crf", String(({ fast: 28, draft: 28, standard: 23, balanced: 23, high: 18, best: 16 })[props.export.quality]), "-pix_fmt", "yuv420p",
	);
	if (threads !== null) args.push("-threads", String(threads));
	if (audioLabel) args.push("-c:a", "aac", "-b:a", "192k");
	args.push("-movflags", "+faststart", output);
	return args;
}
