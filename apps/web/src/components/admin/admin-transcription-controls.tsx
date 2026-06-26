"use client";

/* eslint-disable opencut/prefer-object-params, @typescript-eslint/no-unsafe-type-assertion */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, FlaskConical, Power, Save } from "lucide-react";
import { DEFAULT_PIPELINE_OPTIONS, TRANSCRIPTION_PROVIDER_CATALOG, defaultProviderOptions, isTranscriptionProvider, mergePipelineOptions, type TranscriptionProvider } from "@/transcription/provider-catalog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

type Configuration = {
	id: string;
	provider: TranscriptionProvider;
	model: string;
	providerOptions: Record<string, unknown>;
	pipelineOptions: Record<string, unknown>;
	timestampStrategy: string;
	status: string;
	version: number;
	testStatus: string;
	testErrorCode: string | null;
	testLatencyMs: number | null;
	testedAt: Date | string | null;
	activatedAt: Date | string | null;
	activationReason: string | null;
	createdAt?: Date | string | null;
	updatedAt?: Date | string | null;
	createdBy?: string | null;
	activationEligibility?: boolean;
};

type MutationResponse = {
	ok?: boolean;
	after?: unknown;
	error?: string;
	code?: string;
	stepUp?: string;
	correlationId?: string;
};

async function mutate(body: Record<string, unknown>) {
	const response = await fetch("/api/admin/mutations", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const payload = (await response.json().catch(() => null)) as MutationResponse | null;
	if (!response.ok) {
		const message = [payload?.error, payload?.code]
			.filter(Boolean)
			.join(" ")
			.trim();
		const error = new Error(message || "The operation could not be completed.");
		if (payload && typeof payload === "object" && "stepUp" in payload) {
			Object.assign(error, { stepUp: String(payload.stepUp) });
		}
		throw error;
	}
	return payload;
}

type PipelineOptions = Record<string, unknown>;

function section(options: PipelineOptions, key: string): PipelineOptions {
	const value = options[key];
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as PipelineOptions)
		: {};
}

function numberValue(value: unknown, fallback: number) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback = false) {
	return typeof value === "boolean" ? value : fallback;
}

function stringValue(value: unknown, fallback: string) {
	return typeof value === "string" ? value : fallback;
}

function updateNested(
	options: PipelineOptions,
	key: string,
	field: string,
	value: unknown,
) {
	return {
		...options,
		[key]: {
			...section(options, key),
			[field]: value,
		},
	};
}

function numericInputValue(value: unknown, fallback: number) {
	return String(numberValue(value, fallback));
}

type BulkFieldType = "boolean" | "number" | "string" | "nullableNumber";

type BulkField = {
	key: string;
	path: readonly [string, string] | readonly ["timingSourcePolicy"];
	type: BulkFieldType;
	min?: number;
	max?: number;
	aliases?: readonly string[];
};

const TIMING_FIX_PRESET = `# Short-form Telugu/Telgish timing preset
TIMING_SOURCE_POLICY=native_then_forced
VAD_TARGET_SECONDS=8
VAD_MAX_SECONDS=12
CHUNK_PADDING_SECONDS=0.18
USE_VAD_CHUNKING=true
PAUSE_SPLIT_SECONDS=0.25
SILENCE_THRESHOLD_DB=adaptive
ENABLE_SILERO_VAD=true
SILERO_THRESHOLD=0.5
SILERO_MIN_SPEECH_DURATION_MS=80
SILERO_MIN_SILENCE_DURATION_MS=180
SILERO_SPEECH_PAD_MS=30
ENABLE_STABLE_TS=true
STABLE_TS_MODEL=small
MIN_MATCH_COVERAGE=0.50
ALLOW_STABLE_TS_ORDER_FALLBACK=false
ENABLE_AUTO_GLOBAL_SYNC=false
MAX_SHIFT_SECONDS=0.8
MIN_SYNC_SCORE=0.58
ALLOW_SPEED_SKEW_CORRECTION=false
MAX_SKEW_DELTA=0.03
CAPTION_MAX_WORDS=3
CAPTION_MAX_CHARS=28
MAX_DURATION_SECONDS=2
PHRASE_HOLD_SECONDS=0.05
PROVIDER_TIMEOUT_SECONDS=90
SARVAM_CONCURRENCY=1
ALLOW_ESTIMATED_WORDS=true
MAXIMUM_ESTIMATED_WORD_RATIO=0.15`;

const BULK_FIELDS: readonly BulkField[] = [
	{ key: "TIMING_SOURCE_POLICY", path: ["timingSourcePolicy"], type: "string" },
	{ key: "VAD_TARGET_SECONDS", path: ["audioChunking", "targetSeconds"], type: "number", min: 3, max: 120 },
	{ key: "VAD_MAX_SECONDS", path: ["audioChunking", "maxSeconds"], type: "number", min: 3, max: 180 },
	{ key: "CHUNK_PADDING_SECONDS", path: ["audioChunking", "paddingSeconds"], type: "number", min: 0, max: 2 },
	{ key: "USE_VAD_CHUNKING", path: ["audioChunking", "vadEnabled"], type: "boolean" },
	{
		key: "PAUSE_SPLIT_SECONDS",
		path: ["vad", "pauseThresholdSeconds"],
		type: "number",
		min: 0.05,
		max: 3,
		aliases: ["CAPTION_PAUSE_SPLIT_THRESHOLD_SECONDS"],
	},
	{ key: "SILENCE_THRESHOLD_DB", path: ["vad", "silenceThresholdDb"], type: "nullableNumber", min: -90, max: 0 },
	{ key: "ENABLE_SILERO_VAD", path: ["vad", "sileroEnabled"], type: "boolean" },
	{ key: "SILERO_THRESHOLD", path: ["vad", "sileroSpeechThreshold"], type: "number", min: 0.01, max: 0.99 },
	{ key: "SILERO_MIN_SPEECH_DURATION_MS", path: ["vad", "sileroMinSpeechDurationMs"], type: "number", min: 0, max: 2000 },
	{ key: "SILERO_MIN_SILENCE_DURATION_MS", path: ["vad", "sileroMinSilenceDurationMs"], type: "number", min: 0, max: 3000 },
	{ key: "SILERO_SPEECH_PAD_MS", path: ["vad", "sileroSpeechPadMs"], type: "number", min: 0, max: 1000 },
	{ key: "ENABLE_STABLE_TS", path: ["alignment", "stableTsEnabled"], type: "boolean" },
	{ key: "STABLE_TS_MODEL", path: ["alignment", "stableTsModel"], type: "string" },
	{ key: "MIN_MATCH_COVERAGE", path: ["alignment", "stableTsMinMatchCoverage"], type: "number", min: 0, max: 1 },
	{ key: "ALLOW_STABLE_TS_ORDER_FALLBACK", path: ["alignment", "allowStableTsOrderFallback"], type: "boolean" },
	{ key: "ENABLE_AUTO_GLOBAL_SYNC", path: ["autoSync", "enabled"], type: "boolean" },
	{ key: "MAX_SHIFT_SECONDS", path: ["autoSync", "maxShiftSeconds"], type: "number", min: 0, max: 10 },
	{ key: "MIN_SYNC_SCORE", path: ["autoSync", "minScore"], type: "number", min: 0, max: 1 },
	{ key: "ALLOW_SPEED_SKEW_CORRECTION", path: ["autoSync", "allowSkew"], type: "boolean" },
	{ key: "MAX_SKEW_DELTA", path: ["autoSync", "maxSkewDelta"], type: "number", min: 0, max: 1 },
	{ key: "CAPTION_MAX_WORDS", path: ["captionChunking", "maxWords"], type: "number", min: 1, max: 24 },
	{ key: "CAPTION_MAX_CHARS", path: ["captionChunking", "maxCharacters"], type: "number", min: 8, max: 120 },
	{ key: "MAX_DURATION_SECONDS", path: ["captionChunking", "maxDurationSeconds"], type: "number", min: 0.1, max: 30 },
	{ key: "PHRASE_HOLD_SECONDS", path: ["captionChunking", "phraseHoldSeconds"], type: "number", min: 0, max: 3 },
	{ key: "PROVIDER_TIMEOUT_SECONDS", path: ["performance", "providerTimeoutSeconds"], type: "number", min: 5, max: 600 },
	{ key: "SARVAM_CONCURRENCY", path: ["performance", "sarvamMaxConcurrency"], type: "number", min: 1, max: 8 },
	{ key: "ALLOW_ESTIMATED_WORDS", path: ["quality", "allowEstimatedWords"], type: "boolean" },
	{ key: "MAXIMUM_ESTIMATED_WORD_RATIO", path: ["quality", "maximumEstimatedWordRatio"], type: "number", min: 0, max: 1 },
] as const;

const BULK_FIELD_BY_KEY = new Map<string, BulkField>(
	BULK_FIELDS.flatMap((field) => [
		[field.key, field],
		...(field.aliases ?? []).map((alias) => [alias, field] as const),
	]),
);

function parseBooleanValue(value: string) {
	const normalized = value.trim().toLowerCase();
	if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
	if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
	return null;
}

function parseBulkValue(field: BulkField, rawValue: string) {
	const value = rawValue.trim();
	if (field.type === "boolean") {
		const parsed = parseBooleanValue(value);
		if (parsed === null) throw new Error(`${field.key} must be true or false.`);
		return parsed;
	}
	if (field.type === "string") {
		return value;
	}
	if (field.type === "nullableNumber" && ["", "adaptive", "null", "none"].includes(value.toLowerCase())) {
		return null;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) throw new Error(`${field.key} must be a number.`);
	if (field.min !== undefined && parsed < field.min) throw new Error(`${field.key} must be at least ${field.min}.`);
	if (field.max !== undefined && parsed > field.max) throw new Error(`${field.key} must be at most ${field.max}.`);
	return parsed;
}

function applyPipelineBulkText(current: PipelineOptions, text: string) {
	const errors: string[] = [];
	const applied: string[] = [];
	let next: PipelineOptions = { ...current };

	for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const separatorIndex = line.indexOf("=");
		if (separatorIndex <= 0) {
			errors.push(`Line ${index + 1}: use KEY=value.`);
			continue;
		}
		const rawKey = line.slice(0, separatorIndex).trim().replace(/\./g, "_").toUpperCase();
		const field = BULK_FIELD_BY_KEY.get(rawKey);
		if (!field) {
			errors.push(`Line ${index + 1}: unknown key ${rawKey}.`);
			continue;
		}
		try {
			const parsed = parseBulkValue(field, line.slice(separatorIndex + 1));
			if (field.path.length === 1) {
				next = { ...next, timingSourcePolicy: parsed };
			} else {
				next = updateNested(next, field.path[0], field.path[1], parsed);
				if (field.key === "PAUSE_SPLIT_SECONDS") {
					next = updateNested(next, "captionChunking", "pauseSplitThresholdSeconds", parsed);
				}
			}
			applied.push(field.key);
		} catch (error) {
			errors.push(`Line ${index + 1}: ${error instanceof Error ? error.message : "invalid value"}`);
		}
	}

	return { next, errors, applied };
}

function isConfiguration(value: unknown): value is Configuration {
	return !!value && typeof value === "object" && "id" in value && "provider" in value && "model" in value;
}

function configurationLabel(config: Pick<Configuration, "provider" | "model">) {
	const entry = TRANSCRIPTION_PROVIDER_CATALOG.find(
		(item) => item.provider === config.provider && item.model === config.model,
	);
	return entry?.displayName ?? `${config.provider} ${config.model}`;
}

export function AdminTranscriptionControls({
	active,
	configurations,
	healthStatus,
	timingHealth,
	lastProductionRequest,
}: {
	active: Configuration | null;
	configurations: Configuration[];
	healthStatus: string;
	timingHealth: Record<string, unknown> | null;
	lastProductionRequest: string | null;
}) {
	const router = useRouter();
	const [savedConfigurations, setSavedConfigurations] = useState<Configuration[]>(configurations);
	const drafts = savedConfigurations.filter((item) => item.status !== "active");
	const hasConfigurations = savedConfigurations.length > 0;
	const [provider, setProvider] = useState<TranscriptionProvider>(active?.provider ?? "sarvam");
	const models = useMemo(
		() => TRANSCRIPTION_PROVIDER_CATALOG.filter((entry) => entry.provider === provider),
		[provider],
	);
	const [model, setModel] = useState<string>(active?.model ?? "saaras:v3");
	const selectedEntry = models.find((entry) => entry.model === model) ?? models[0];
	const [sarvamMode, setSarvamMode] = useState("transcribe");
	const [pipelineOptions, setPipelineOptions] = useState<PipelineOptions>(() =>
		mergePipelineOptions(
			DEFAULT_PIPELINE_OPTIONS,
			active?.pipelineOptions ?? {},
		),
	);
	const [bulkText, setBulkText] = useState(TIMING_FIX_PRESET);
	const [bulkMessage, setBulkMessage] = useState<string | null>(null);
	const [reason, setReason] = useState("Initial transcription setup");
	const [confirmation, setConfirmation] = useState("");
	const [selectedConfigId, setSelectedConfigId] = useState(active?.id ?? drafts[0]?.id ?? "");
	const selectedConfig = savedConfigurations.find((item) => item.id === selectedConfigId) ?? null;
	const [message, setMessage] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();
	const currentDraftLabel = selectedEntry?.displayName ?? `${provider} ${model}`;
	const realForcedAlignmentAvailable = timingHealth?.realForcedAlignmentAvailable === true;
	const selectedModelUnavailable =
		selectedEntry?.localAlignmentRequired === true && !realForcedAlignmentAvailable;
	const selectedConfigEntry = selectedConfig
		? TRANSCRIPTION_PROVIDER_CATALOG.find(
			(entry) => entry.provider === selectedConfig.provider && entry.model === selectedConfig.model,
		)
		: null;
	const selectedConfigUnavailable =
		selectedConfigEntry?.localAlignmentRequired === true && !realForcedAlignmentAvailable;
	const forcedAlignmentReason = Array.isArray(timingHealth?.forcedAlignmentUnavailableReasons)
		? timingHealth.forcedAlignmentUnavailableReasons.join(", ")
		: "backend aligner unavailable";

	const run = (body: Record<string, unknown>) => {
		setMessage(null);
		startTransition(async () => {
			try {
				const payload = (await mutate(body)) as MutationResponse;
				if (isConfiguration(payload.after)) {
					const saved = payload.after;
					setSavedConfigurations((current) => {
						const withoutSaved = current.filter((item) => item.id !== saved.id);
						return [saved, ...withoutSaved];
					});
					setSelectedConfigId(saved.id);
				}
				if (body.action === "transcription.config.create_draft") {
					setMessage("Draft saved. The exact saved version is ready to test.");
				} else if (body.action === "transcription.config.test") {
					setMessage("Test result saved for the selected configuration version.");
				} else if (body.action === "transcription.config.activate") {
					setMessage("Configuration activated for new caption jobs.");
				} else {
					setMessage("Configuration updated.");
				}
				router.refresh();
			} catch (error) {
				if (error instanceof Error && "stepUp" in error && typeof error.stepUp === "string") {
					setMessage("A fresh MFA verification is required before this action can continue.");
					router.push(error.stepUp);
					return;
				}
				setMessage(error instanceof Error ? error.message : "The operation could not be completed.");
			}
		});
	};
	const audioChunking = section(pipelineOptions, "audioChunking");
	const vad = section(pipelineOptions, "vad");
	const alignment = section(pipelineOptions, "alignment");
	const autoSync = section(pipelineOptions, "autoSync");
	const captionChunking = section(pipelineOptions, "captionChunking");
	const performance = section(pipelineOptions, "performance");
	const quality = section(pipelineOptions, "quality");
	const nativeRequired = stringValue(pipelineOptions.timingSourcePolicy, "native_then_forced") === "native_required";
	const allowEstimatedWords = !nativeRequired && booleanValue(quality.allowEstimatedWords, false);

	const setPipelineValue = (key: string, field: string, value: unknown) => {
		setPipelineOptions((current) => updateNested(current, key, field, value));
	};

	const applyBulkText = () => {
		const result = applyPipelineBulkText(pipelineOptions, bulkText);
		if (result.errors.length > 0) {
			setBulkMessage(result.errors.slice(0, 4).join(" "));
			return;
		}
		setPipelineOptions(result.next);
		setBulkMessage(`Applied ${result.applied.length} parameter${result.applied.length === 1 ? "" : "s"}. Save a draft to persist these values.`);
	};

	return (
		<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
			<div className="grid gap-4">
				<Card className="border-2">
					<CardHeader>
						<CardTitle>Active Configuration</CardTitle>
						<CardDescription>
							Only new caption jobs use the active provider and model. Existing jobs retain their original snapshot.
						</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
						<div><Label>Provider</Label><p className="font-semibold">{active?.provider ?? "Backend env fallback"}</p></div>
						<div><Label>Model</Label><p className="font-semibold">{active?.model ?? "Existing backend setting"}</p></div>
						<div><Label>Strategy</Label><p className="font-semibold">{active?.timestampStrategy ?? "Bootstrap fallback"}</p></div>
						<div><Label>Timing policy</Label><p className="font-semibold">{String(active?.pipelineOptions?.timingSourcePolicy ?? "native_then_forced")}</p></div>
						<div><Label>Version</Label><p className="font-semibold">{active?.version ?? "-"}</p></div>
						<div><Label>Health</Label><Badge variant="outline">{healthStatus}</Badge></div>
						<div><Label>Last test</Label><p className="text-sm">{active?.testStatus ?? "Save and test a draft"} {active?.testLatencyMs ? `(${active.testLatencyMs} ms)` : ""}</p></div>
						<div><Label>Last production request</Label><p className="text-sm">{lastProductionRequest ?? "None recorded"}</p></div>
						<div><Label>Last failure</Label><p className="text-sm">{active?.testErrorCode ?? "None recorded"}</p></div>
					</CardContent>
				</Card>

				<Card className="border-2">
					<CardHeader>
						<CardTitle>Edit Draft</CardTitle>
						<CardDescription>Step 1: save the current provider/model draft. Step 2: test that exact saved version, then activate it.</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-4 md:grid-cols-2">
						<div className="grid gap-2">
							<Label>Provider</Label>
							<Select value={provider} onValueChange={(value) => {
								const next = isTranscriptionProvider(value) ? value : "sarvam";
								const nextModel = TRANSCRIPTION_PROVIDER_CATALOG.find((entry) => entry.provider === next)?.model ?? "saaras:v3";
								setProvider(next);
								setModel(nextModel);
								const matchingDraft = savedConfigurations.find(
									(item) => item.provider === next && item.model === nextModel && item.status !== "active",
								);
								setSelectedConfigId(matchingDraft?.id ?? "");
							}}>
								<SelectTrigger><SelectValue /></SelectTrigger>
								<SelectContent>
									<SelectItem value="gemini">Gemini</SelectItem>
									<SelectItem value="openai">OpenAI</SelectItem>
									<SelectItem value="sarvam">Sarvam</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-2">
							<Label>Model</Label>
							<Select value={model} onValueChange={(nextModel) => {
								setModel(nextModel);
								const matchingDraft = savedConfigurations.find(
									(item) => item.provider === provider && item.model === nextModel && item.status !== "active",
								);
								setSelectedConfigId(matchingDraft?.id ?? "");
							}}>
								<SelectTrigger><SelectValue /></SelectTrigger>
								<SelectContent>
									{models.map((entry) => <SelectItem key={entry.model} value={entry.model}>{entry.displayName}</SelectItem>)}
								</SelectContent>
							</Select>
						</div>
						<div className="md:col-span-2">
							<Label>Timestamp capability</Label>
							<p className="text-sm text-muted-foreground">{selectedEntry?.timestampCapability}</p>
							{selectedEntry?.localAlignmentRequired ? (
								<p className="mt-1 text-xs text-caution">
									{selectedModelUnavailable
										? `Requires forced alignment - backend aligner unavailable (${forcedAlignmentReason}).`
										: "Backend forced alignment is available for this model."}
								</p>
							) : null}
							{provider === "sarvam" ? (
								<p className="mt-1 text-xs text-muted-foreground">
									Verbatim changes transcript normalization only; native word timing depends on REST with_timestamps=true.
								</p>
							) : null}
						</div>
						{provider === "sarvam" ? (
							<div className="grid gap-2">
								<Label>Output mode</Label>
								<Select value={sarvamMode} onValueChange={setSarvamMode}>
									<SelectTrigger><SelectValue /></SelectTrigger>
									<SelectContent>
										<SelectItem value="transcribe">Transcribe</SelectItem>
										<SelectItem value="verbatim">Verbatim</SelectItem>
										<SelectItem value="translit">Translit</SelectItem>
										<SelectItem value="codemix">Codemix</SelectItem>
									</SelectContent>
								</Select>
							</div>
						) : null}
						<div className="grid gap-3 border p-4 md:col-span-2">
							<div>
								<Label>Paste Parameters</Label>
								<p className="mt-1 text-xs text-muted-foreground">
									Paste KEY=value lines like Coolify env vars. This updates the form below; it is saved only after Save draft.
								</p>
							</div>
							<Textarea
								value={bulkText}
								onChange={(event) => {
									setBulkText(event.currentTarget.value);
									setBulkMessage(null);
								}}
								spellCheck={false}
								className="min-h-72 font-mono text-xs"
							/>
							<div className="flex flex-wrap gap-2">
								<Button type="button" variant="outline" onClick={() => {
									setBulkText(TIMING_FIX_PRESET);
									setBulkMessage("Loaded the short-form Telugu/Telgish timing preset. Apply it, then save a draft.");
								}}>
									Load timing preset
								</Button>
								<Button type="button" onClick={applyBulkText}>
									Apply pasted values
								</Button>
							</div>
							{bulkMessage ? <p className="text-sm text-muted-foreground">{bulkMessage}</p> : null}
						</div>
						<div className="grid gap-4 border p-4 md:col-span-2">
							<div>
								<Label>Timing source policy</Label>
								<Select
									value={stringValue(pipelineOptions.timingSourcePolicy, "native_then_forced")}
									onValueChange={(value) =>
										setPipelineOptions((current) => ({
											...current,
											timingSourcePolicy: value,
										}))
									}
								>
									<SelectTrigger><SelectValue /></SelectTrigger>
									<SelectContent>
										<SelectItem value="native_required">Native required</SelectItem>
										<SelectItem value="native_then_forced">Native, then forced alignment</SelectItem>
										<SelectItem value="forced">Forced alignment only</SelectItem>
										<SelectItem value="estimated_debug_only">Estimated debug only</SelectItem>
									</SelectContent>
								</Select>
								<p className="mt-1 text-xs text-muted-foreground">
									Controls whether production accepts provider words, runs real alignment, or rejects estimated timings.
								</p>
							</div>

							<div className="grid gap-3 md:grid-cols-3">
								<div className="grid gap-2">
									<Label>VAD target seconds</Label>
									<Input
										type="number"
										step="0.5"
										min="3"
										max="120"
										value={numericInputValue(audioChunking.targetSeconds, 15)}
										onChange={(event) => setPipelineValue("audioChunking", "targetSeconds", Number(event.currentTarget.value))}
									/>
								</div>
								<div className="grid gap-2">
									<Label>VAD max seconds</Label>
									<Input
										type="number"
										step="0.5"
										min="3"
										max="180"
										value={numericInputValue(audioChunking.maxSeconds, 25)}
										onChange={(event) => setPipelineValue("audioChunking", "maxSeconds", Number(event.currentTarget.value))}
									/>
								</div>
								<div className="grid gap-2">
									<Label>Chunk padding seconds</Label>
									<Input
										type="number"
										step="0.01"
										min="0"
										max="2"
										value={numericInputValue(audioChunking.paddingSeconds, 0.08)}
										onChange={(event) => setPipelineValue("audioChunking", "paddingSeconds", Number(event.currentTarget.value))}
									/>
								</div>
								<label className="flex items-center gap-2 text-sm font-medium">
									<input
										type="checkbox"
										checked={booleanValue(audioChunking.vadEnabled, true)}
										onChange={(event) => setPipelineValue("audioChunking", "vadEnabled", event.currentTarget.checked)}
									/>
									Use VAD chunking
								</label>
							</div>

							<div className="grid gap-3 md:grid-cols-3">
								<div className="grid gap-2">
									<Label>Pause split seconds</Label>
									<Input
										type="number"
										step="0.01"
										min="0.05"
										max="3"
										value={numericInputValue(vad.pauseThresholdSeconds, 0.3)}
										onChange={(event) => {
											const value = Number(event.currentTarget.value);
											setPipelineValue("vad", "pauseThresholdSeconds", value);
											setPipelineValue("captionChunking", "pauseSplitThresholdSeconds", value);
										}}
									/>
								</div>
								<div className="grid gap-2">
									<Label>Silence threshold dB</Label>
									<Input
										type="number"
										step="1"
										min="-90"
										max="0"
										placeholder="Adaptive"
										value={vad.silenceThresholdDb === null || vad.silenceThresholdDb === undefined ? "" : String(vad.silenceThresholdDb)}
										onChange={(event) => setPipelineValue("vad", "silenceThresholdDb", event.currentTarget.value === "" ? null : Number(event.currentTarget.value))}
									/>
								</div>
								<div className="grid gap-2">
									<Label>Silero threshold</Label>
									<Input
										type="number"
										step="0.01"
										min="0.01"
										max="0.99"
										value={numericInputValue(vad.sileroSpeechThreshold, 0.5)}
										onChange={(event) => setPipelineValue("vad", "sileroSpeechThreshold", Number(event.currentTarget.value))}
									/>
								</div>
								<label className="flex items-center gap-2 text-sm font-medium">
									<input
										type="checkbox"
										checked={booleanValue(vad.sileroEnabled, true)}
										onChange={(event) => setPipelineValue("vad", "sileroEnabled", event.currentTarget.checked)}
									/>
									Enable Silero VAD
								</label>
							</div>

							<div className="grid gap-3 md:grid-cols-3">
								<label className="flex items-center gap-2 text-sm font-medium">
									<input
										type="checkbox"
										checked={booleanValue(alignment.stableTsEnabled, false)}
										onChange={(event) => setPipelineValue("alignment", "stableTsEnabled", event.currentTarget.checked)}
									/>
									Enable stable-ts
								</label>
								<div className="grid gap-2">
									<Label>Stable-ts model</Label>
									<Select
										value={stringValue(alignment.stableTsModel, "base")}
										onValueChange={(value) => setPipelineValue("alignment", "stableTsModel", value)}
									>
										<SelectTrigger><SelectValue /></SelectTrigger>
										<SelectContent>
											<SelectItem value="tiny">Tiny</SelectItem>
											<SelectItem value="base">Base</SelectItem>
											<SelectItem value="small">Small</SelectItem>
											<SelectItem value="medium">Medium</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div className="grid gap-2">
									<Label>Min match coverage</Label>
									<Input
										type="number"
										step="0.01"
										min="0"
										max="1"
										value={numericInputValue(alignment.stableTsMinMatchCoverage, 0.5)}
										onChange={(event) => setPipelineValue("alignment", "stableTsMinMatchCoverage", Number(event.currentTarget.value))}
									/>
								</div>
								<label className="flex items-center gap-2 text-sm font-medium">
									<input
										type="checkbox"
										checked={booleanValue(alignment.allowStableTsOrderFallback, false)}
										onChange={(event) => setPipelineValue("alignment", "allowStableTsOrderFallback", event.currentTarget.checked)}
									/>
									Allow stable-ts order fallback
								</label>
							</div>

							<div className="grid gap-3 md:grid-cols-3">
								<label className="flex items-center gap-2 text-sm font-medium">
									<input
										type="checkbox"
										checked={booleanValue(autoSync.enabled, false)}
										onChange={(event) => setPipelineValue("autoSync", "enabled", event.currentTarget.checked)}
									/>
									Enable auto global sync
								</label>
								<div className="grid gap-2">
									<Label>Max shift seconds</Label>
									<Input
										type="number"
										step="0.05"
										min="0"
										max="10"
										value={numericInputValue(autoSync.maxShiftSeconds, 2)}
										onChange={(event) => setPipelineValue("autoSync", "maxShiftSeconds", Number(event.currentTarget.value))}
									/>
								</div>
								<div className="grid gap-2">
									<Label>Min sync score</Label>
									<Input
										type="number"
										step="0.01"
										min="0"
										max="1"
										value={numericInputValue(autoSync.minScore, 0.58)}
										onChange={(event) => setPipelineValue("autoSync", "minScore", Number(event.currentTarget.value))}
									/>
								</div>
								<label className="flex items-center gap-2 text-sm font-medium">
									<input
										type="checkbox"
										checked={booleanValue(autoSync.allowSkew, false)}
										onChange={(event) => setPipelineValue("autoSync", "allowSkew", event.currentTarget.checked)}
									/>
									Allow speed/skew correction
								</label>
								<div className="grid gap-2">
									<Label>Max skew delta</Label>
									<Input
										type="number"
										step="0.001"
										min="0"
										max="1"
										value={numericInputValue(autoSync.maxSkewDelta, 0.02)}
										onChange={(event) => setPipelineValue("autoSync", "maxSkewDelta", Number(event.currentTarget.value))}
									/>
								</div>
							</div>

							<div className="grid gap-3 md:grid-cols-4">
								<div className="grid gap-2">
									<Label>Caption max words</Label>
									<Input
										type="number"
										min="1"
										max="24"
										value={numericInputValue(captionChunking.maxWords, 5)}
										onChange={(event) => setPipelineValue("captionChunking", "maxWords", Number(event.currentTarget.value))}
									/>
								</div>
								<div className="grid gap-2">
									<Label>Caption max chars</Label>
									<Input
										type="number"
										min="8"
										max="120"
										value={numericInputValue(captionChunking.maxCharacters, 36)}
										onChange={(event) => setPipelineValue("captionChunking", "maxCharacters", Number(event.currentTarget.value))}
									/>
								</div>
								<div className="grid gap-2">
									<Label>Max duration seconds</Label>
									<Input
										type="number"
										step="0.1"
										min="0.1"
										max="30"
										value={numericInputValue(captionChunking.maxDurationSeconds, 3)}
										onChange={(event) => setPipelineValue("captionChunking", "maxDurationSeconds", Number(event.currentTarget.value))}
									/>
								</div>
								<div className="grid gap-2">
									<Label>Phrase hold seconds</Label>
									<Input
										type="number"
										step="0.01"
										min="0"
										max="3"
										value={numericInputValue(captionChunking.phraseHoldSeconds, 0.12)}
										onChange={(event) => setPipelineValue("captionChunking", "phraseHoldSeconds", Number(event.currentTarget.value))}
									/>
								</div>
							</div>

							<div className="grid gap-3 md:grid-cols-3">
								<div className="grid gap-2">
									<Label>Provider timeout seconds</Label>
									<Input
										type="number"
										min="5"
										max="600"
										value={numericInputValue(performance.providerTimeoutSeconds, 60)}
										onChange={(event) => setPipelineValue("performance", "providerTimeoutSeconds", Number(event.currentTarget.value))}
									/>
								</div>
								<div className="grid gap-2">
									<Label>Sarvam concurrency</Label>
									<Input
										type="number"
										min="1"
										max="8"
										value={numericInputValue(performance.sarvamMaxConcurrency, 2)}
										onChange={(event) => setPipelineValue("performance", "sarvamMaxConcurrency", Number(event.currentTarget.value))}
									/>
								</div>
								<label className="flex items-center gap-2 text-sm font-medium">
									<input
										type="checkbox"
										disabled={nativeRequired}
										checked={allowEstimatedWords}
										onChange={(event) => setPipelineValue("quality", "allowEstimatedWords", event.currentTarget.checked)}
									/>
									{nativeRequired ? "Estimated words disabled for native required" : "Allow estimated words"}
								</label>
								<div className="grid gap-2">
									<Label>Maximum estimated word ratio</Label>
									<Input
										type="number"
										step="0.01"
										min="0"
										max="1"
										disabled={!allowEstimatedWords}
										value={numericInputValue(quality.maximumEstimatedWordRatio, 0.15)}
										onChange={(event) => setPipelineValue("quality", "maximumEstimatedWordRatio", Number(event.currentTarget.value))}
									/>
									<p className="text-xs text-muted-foreground">
										Maximum fraction of caption words allowed to use estimated timing after alignment. 0.15 means 15%.
									</p>
								</div>
							</div>
						</div>
						<div className="grid gap-2 md:col-span-2">
							<Label>Reason</Label>
							<Textarea value={reason} onChange={(event) => setReason(event.target.value)} className="min-h-24" />
							<p className="text-xs text-muted-foreground">This reason is used for save, test, and activation audit entries.</p>
						</div>
						<Button
							disabled={isPending || reason.trim().length < 8}
							onClick={() => run({
								action: "transcription.config.create_draft",
								targetId: "new",
								provider,
								model,
								providerOptions: provider === "sarvam" ? { ...defaultProviderOptions("sarvam"), mode: sarvamMode } : {},
								pipelineOptions,
								reason,
							})}
						>
							<Save className="mr-2 size-4" /> {isPending ? "Saving..." : "Save draft"}
						</Button>
					</CardContent>
				</Card>
			</div>

			<Card className="border-2">
				<CardHeader>
					<CardTitle>Test And Activate</CardTitle>
					<CardDescription>Activation requires the selected exact draft version to pass a real audio test.</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4">
					{hasConfigurations ? (
						<Select value={selectedConfigId} onValueChange={setSelectedConfigId}>
							<SelectTrigger><SelectValue placeholder="Choose saved draft" /></SelectTrigger>
							<SelectContent>
								{savedConfigurations.map((item) => (
									<SelectItem key={item.id} value={item.id}>{configurationLabel(item)} / v{item.version} / {item.status}</SelectItem>
								))}
							</SelectContent>
						</Select>
					) : (
						<div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
							No saved {currentDraftLabel} configuration yet. Save the current draft first; it will appear here immediately after persistence succeeds.
						</div>
					)}
					{selectedConfig ? (
						<div className="grid gap-2 rounded-md border p-3 text-sm">
							<p><strong>{configurationLabel(selectedConfig)}</strong></p>
							<p>Configuration ID: {selectedConfig.id}</p>
							<p>{selectedConfig.timestampStrategy}</p>
							<p>Timing policy: {String(selectedConfig.pipelineOptions?.timingSourcePolicy ?? "native_then_forced")}</p>
							<p>Test: {selectedConfig.testStatus}{selectedConfig.testErrorCode ? ` (${selectedConfig.testErrorCode})` : ""}</p>
							<p>Version: {selectedConfig.version}</p>
							{selectedConfigUnavailable ? (
								<p className="font-semibold text-destructive">
									Requires forced alignment - backend aligner unavailable.
								</p>
							) : null}
							<details className="mt-2">
								<summary className="cursor-pointer font-semibold">Resolved configuration preview</summary>
								<pre className="mt-2 max-h-72 overflow-auto rounded-sm border bg-muted p-2 text-xs">{JSON.stringify(selectedConfig.pipelineOptions ?? DEFAULT_PIPELINE_OPTIONS, null, 2)}</pre>
							</details>
						</div>
					) : null}
					<Label>Activation confirmation</Label>
					<Input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="ACTIVATE" />
					<Button
						variant="outline"
						disabled={isPending || !selectedConfig || selectedConfigUnavailable || reason.trim().length < 8}
						onClick={() => selectedConfig && run({
							action: "transcription.config.test",
							targetId: selectedConfig.id,
							version: selectedConfig.version,
							reason,
						})}
					>
						<FlaskConical className="mr-2 size-4" /> {selectedConfig ? "Test configuration" : "Save a draft first"}
					</Button>
					<Button
						disabled={isPending || !selectedConfig || selectedConfigUnavailable || selectedConfig.testStatus !== "passed" || confirmation !== "ACTIVATE" || reason.trim().length < 8}
						onClick={() => selectedConfig && run({
							action: "transcription.config.activate",
							targetId: selectedConfig.id,
							version: selectedConfig.version,
							confirmation,
							reason,
						})}
					>
						<Power className="mr-2 size-4" /> Activate
					</Button>
					<p className="text-sm text-muted-foreground">
						Only new caption jobs will use this configuration. Existing jobs retain their original provider and model.
					</p>
					<div className="rounded-md border p-3">
						<div className="mb-2 flex items-center gap-2">
							{healthStatus === "healthy" ? <CheckCircle2 className="size-4 text-constructive" /> : <CircleAlert className="size-4 text-caution" />}
							<span className="font-semibold">Health</span>
						</div>
						<p className="text-sm text-muted-foreground">{healthStatus}</p>
					</div>
					{message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
				</CardContent>
			</Card>
		</div>
	);
}
