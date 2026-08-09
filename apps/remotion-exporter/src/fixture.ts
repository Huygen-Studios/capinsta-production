import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { getCapinstaPresetStyle } from "../../web/src/capinsta/styles/presetRegistry";
import type { NeutralCaptionDocument } from "../../web/src/capinsta/types";
import type { CapinstaCaptionPresetId } from "../../web/src/capinsta/styles/styleTypes";
import type { CapInstaRemotionPropsV1 } from "./contracts";
import { GENERATED_DIR } from "./paths";

const SOURCE_ID = "moving-source";
const SOURCE_URL = "/remotion-fixtures/moving-source-30s.mp4";
const PREMIUM_PRESETS: CapinstaCaptionPresetId[] = [
	"skyline_italic", "ember_focus", "citrus_signature", "volt_matrix",
	"ivory_signature", "cobalt_script", "mint_ink", "monument",
];

function run(command: string, args: string[]) {
	return new Promise<void>((resolvePromise, reject) => {
		const child = spawn(command, args, { stdio: "inherit" });
		child.once("error", reject);
		child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited ${code}`)));
	});
}

async function generateMovingSource() {
	const output = resolve(GENERATED_DIR, "moving-source-30s.mp4");
	if (existsSync(output)) return output;
	const font = process.platform === "win32" ? "C\\:/Windows/Fonts/arial.ttf" : "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
	const videoFilter = [
		"testsrc2=size=1080x1920:rate=30:duration=30",
		"drawgrid=width=120:height=120:thickness=3:color=white@0.25",
		`drawtext=fontfile='${font}':text='FRAME %{n}':x=50:y=60:fontsize=72:fontcolor=white:box=1:boxcolor=black@0.65`,
		`drawtext=fontfile='${font}':text='%{pts\\:hms}':x=50:y=150:fontsize=64:fontcolor=yellow:box=1:boxcolor=black@0.65`,
	].join(",");
	await run("ffmpeg", [
		"-hide_banner", "-y", "-f", "lavfi", "-i", videoFilter,
		"-f", "lavfi", "-i", "aevalsrc=0.65*sin(2*PI*880*t)*lt(mod(t\\,1)\\,0.12):s=48000:d=30",
		"-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
		"-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", output,
	]);
	return output;
}

function edl(entries: Array<{ sourceStartMs: number; sourceEndMs: number; playbackRate: number }>) {
	let outputStartMs = 0;
	const mapped = entries.map((entry, order) => {
		const outputDurationMs = Math.round((entry.sourceEndMs - entry.sourceStartMs) / entry.playbackRate);
		const value = {
			id: `edl-${order}`, rangeId: `range-${order}`, order, sourceMediaId: SOURCE_ID,
			sourceStartMs: entry.sourceStartMs, sourceEndMs: entry.sourceEndMs,
			sourceDurationMs: entry.sourceEndMs - entry.sourceStartMs,
			outputStartMs, outputEndMs: outputStartMs + outputDurationMs, outputDurationMs,
			playbackRate: entry.playbackRate, transitionIn: null, transitionOut: null, metadata: {},
		};
		outputStartMs = value.outputEndMs;
		return value;
	});
	return {
		schemaVersion: 1 as const, clipProjectId: "remotion-fixture", projectRevision: 1,
		sourceMediaId: SOURCE_ID, sourceDurationMs: 30_000, outputDurationMs: outputStartMs,
		entries: mapped, warnings: [], metadata: {},
	};
}

function captionDocument(presetId: CapinstaCaptionPresetId, durationSeconds: number, clipCount: number): NeutralCaptionDocument {
	const clips: NeutralCaptionDocument["clips"] = [];
	const words: NeutralCaptionDocument["words"] = [];
	const vocabulary = ["REAL", "MOVING", "SOURCE", "CAPINSTA", "EXPORT", "FRAME"];
	const clipDuration = durationSeconds / clipCount;
	for (let index = 0; index < clipCount; index++) {
		const start = index * clipDuration;
		const end = Math.min(durationSeconds, (index + 1) * clipDuration);
		const wordIds = vocabulary.slice(0, 4).map((text, wordIndex) => {
			const id = `word-${index}-${wordIndex}`;
			const wordStart = start + ((end - start) * wordIndex) / 4;
			words.push({ id, text, displayedText: text, start: wordStart, end: start + ((end - start) * (wordIndex + 1)) / 4, timingSource: "manual", sourceWordId: id });
			return id;
		});
		clips.push({ id: `clip-${index}`, trackId: "caption-track", start, end, text: vocabulary.slice(0, 4).join(" "), wordIds, stylePresetId: presetId, selected: false, editable: true, manuallyEdited: false, timingNeedsReview: false, timingSource: "manual", sourceClipId: `clip-${index}` });
	}
	return {
		id: `fixture-${presetId}`, trackId: "caption-track",
		sourceTranscriptRef: { version: "capinsta.transcript.v1", sourceAssetId: SOURCE_ID, sourceAssetName: "Moving source", provider: "fixture" },
		durationSeconds, languageMode: "english", stylePresetId: presetId, style: getCapinstaPresetStyle(presetId), clips, words,
		manualEdits: {}, timing: { sourceOfTruth: "words", generatedAt: "1970-01-01T00:00:00.000Z", audioDurationSeconds: durationSeconds },
	};
}

function props(timeline: ReturnType<typeof edl>, captions?: NeutralCaptionDocument, sourceUrl = SOURCE_URL): CapInstaRemotionPropsV1 {
	return {
		version: 1,
		export: { width: 1080, height: 1920, fps: 30, quality: "standard", backgroundColor: "#000000" },
		media: { sources: [{ id: SOURCE_ID, url: sourceUrl, hasAudio: true, accessMode: "localized" }] },
		timeline: { edl: timeline },
		captions: captions ? { document: captions } : undefined,
	};
}

async function save(name: string, value: CapInstaRemotionPropsV1) {
	await writeFile(resolve(GENERATED_DIR, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

export async function generateFixtures() {
	await mkdir(GENERATED_DIR, { recursive: true });
	await generateMovingSource();
	const whole = edl([{ sourceStartMs: 0, sourceEndMs: 30_000, playbackRate: 1 }]);
	await save("source-only", props(whole));
	await save("ordinary-captions", props(whole, captionDocument("word_highlight_box", 30, 15)));
	await save("premium-captions", props(whole, captionDocument("skyline_italic", 30, 15)));
	const short = edl([{ sourceStartMs: 0, sourceEndMs: 4_000, playbackRate: 1 }]);
	await save("benchmark-short", props(short));
	await save("ordinary-short", props(short, captionDocument("word_highlight_box", 4, 2)));
	await save("official-benchmark-short", props(short, undefined, "http://127.0.0.1:8899/remotion-fixtures/moving-source-30s.mp4"));
	for (const preset of PREMIUM_PRESETS) await save(`premium-${preset}`, props(short, captionDocument(preset, 4, 2)));
	const edit = edl([
		{ sourceStartMs: 0, sourceEndMs: 5_000, playbackRate: 1 },
		{ sourceStartMs: 10_000, sourceEndMs: 15_000, playbackRate: 1 },
		{ sourceStartMs: 5_000, sourceEndMs: 10_000, playbackRate: 1 },
		{ sourceStartMs: 5_000, sourceEndMs: 10_000, playbackRate: 2 },
	]);
	await save("edl", props(edit, captionDocument("word_highlight_box", edit.outputDurationMs / 1000, 9)));
	const retiming = edl([
		{ sourceStartMs: 0, sourceEndMs: 2_000, playbackRate: 0.5 },
		{ sourceStartMs: 2_000, sourceEndMs: 4_000, playbackRate: 1 },
		{ sourceStartMs: 4_000, sourceEndMs: 6_000, playbackRate: 2 },
	]);
	await save("retiming", props(retiming));
	const representative = edl(Array.from({ length: 6 }, () => ({ sourceStartMs: 0, sourceEndMs: 30_000, playbackRate: 1 })));
	await save("representative-180s", props(representative, captionDocument("word_highlight_box", 180, 118)));
	console.log(JSON.stringify({ event: "remotion_fixtures_complete", directory: GENERATED_DIR }));
}

if (import.meta.main) await generateFixtures();
