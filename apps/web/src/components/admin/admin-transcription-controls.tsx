"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, CircleAlert, FlaskConical, Power, Save } from "lucide-react";
import { TRANSCRIPTION_PROVIDER_CATALOG, defaultProviderOptions, isTranscriptionProvider, type TranscriptionProvider } from "@/transcription/provider-catalog";
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
							<p>Test: {selectedConfig.testStatus}{selectedConfig.testErrorCode ? ` (${selectedConfig.testErrorCode})` : ""}</p>
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
