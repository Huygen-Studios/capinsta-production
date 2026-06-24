"use client";

/* eslint-disable opencut/prefer-object-params, @typescript-eslint/no-unsafe-type-assertion */

import { useMemo, useState, useTransition } from "react";
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
};

async function mutate(body: Record<string, unknown>) {
	const response = await fetch("/api/admin/mutations", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const payload = await response.json().catch(() => null);
	if (!response.ok) throw new Error(payload?.error ?? "The operation could not be completed.");
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

export function AdminTranscriptionControls({
	active,
	configurations,
	healthStatus,
	lastProductionRequest,
}: {
	active: Configuration | null;
	configurations: Configuration[];
	healthStatus: string;
	lastProductionRequest: string | null;
}) {
	const drafts = configurations.filter((item) => item.status !== "active");
	const hasConfigurations = configurations.length > 0;
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
	const [reason, setReason] = useState("Initial Sarvam transcription setup");
	const [confirmation, setConfirmation] = useState("");
	const [selectedConfigId, setSelectedConfigId] = useState(active?.id ?? drafts[0]?.id ?? "");
	const selectedConfig = configurations.find((item) => item.id === selectedConfigId) ?? null;
	const [message, setMessage] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	const run = (body: Record<string, unknown>) => {
		setMessage(null);
		startTransition(async () => {
			try {
				await mutate(body);
				setMessage("Saved. Refreshing current admin data.");
				window.location.reload();
			} catch (error) {
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

	const setPipelineValue = (key: string, field: string, value: unknown) => {
		setPipelineOptions((current) => updateNested(current, key, field, value));
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
						<CardDescription>Step 1: save a Sarvam draft. Step 2: choose that saved draft on the right, test it, then activate it.</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-4 md:grid-cols-2">
						<div className="grid gap-2">
							<Label>Provider</Label>
							<Select value={provider} onValueChange={(value) => {
								const next = isTranscriptionProvider(value) ? value : "sarvam";
								setProvider(next);
								setModel(TRANSCRIPTION_PROVIDER_CATALOG.find((entry) => entry.provider === next)?.model ?? "saaras:v3");
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
							<Select value={model} onValueChange={setModel}>
								<SelectTrigger><SelectValue /></SelectTrigger>
								<SelectContent>
									{models.map((entry) => <SelectItem key={entry.model} value={entry.model}>{entry.displayName}</SelectItem>)}
								</SelectContent>
							</Select>
						</div>
						<div className="md:col-span-2">
							<Label>Timestamp capability</Label>
							<p className="text-sm text-muted-foreground">{selectedEntry?.timestampCapability}</p>
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
										checked={booleanValue(vad.sileroEnabled, false)}
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
										checked={booleanValue(quality.allowEstimatedWords, false)}
										onChange={(event) => setPipelineValue("quality", "allowEstimatedWords", event.currentTarget.checked)}
									/>
									Allow estimated words
								</label>
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
							<Save className="mr-2 size-4" /> Save draft
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
								{configurations.map((item) => (
									<SelectItem key={item.id} value={item.id}>{item.provider} / {item.model} / v{item.version} / {item.status}</SelectItem>
								))}
							</SelectContent>
						</Select>
					) : (
						<div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
							No saved configuration yet. Save the Sarvam draft on the left first; it will appear here after the page refreshes.
						</div>
					)}
					{selectedConfig ? (
						<div className="grid gap-2 rounded-md border p-3 text-sm">
							<p><strong>{selectedConfig.provider}</strong> {selectedConfig.model}</p>
							<p>{selectedConfig.timestampStrategy}</p>
							<p>Timing policy: {String(selectedConfig.pipelineOptions?.timingSourcePolicy ?? "native_then_forced")}</p>
							<p>Test: {selectedConfig.testStatus}{selectedConfig.testErrorCode ? ` (${selectedConfig.testErrorCode})` : ""}</p>
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
						disabled={isPending || !selectedConfig || reason.trim().length < 8}
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
						disabled={isPending || !selectedConfig || selectedConfig.testStatus !== "passed" || confirmation !== "ACTIVATE" || reason.trim().length < 8}
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
