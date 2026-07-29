"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccountMenu } from "@/components/auth/account-menu";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { LogoStatic } from "@/components/logo";
import {
	advanceWorkflow,
	cancelExport,
	createExport,
	discardClipperUpload,
	getExport,
	getExportDownload,
	getProjectJob,
	getProjectStatus,
	isClipperLayoutStrategy,
	listCandidates,
	prepareHandoff,
	preparePreview,
	regenerateCandidates,
	rejectCandidate,
	requestConversion,
	selectCandidate,
	uploadClipperMedia,
	type ClipperLayoutStrategy,
	type ClipperSelection,
	type ViralCandidate,
	type WorkflowSnapshot,
} from "@/services/automatic-clipper/api";

type WorkspaceState =
	| "upload"
	| "paused"
	| "processing"
	| "candidate_review"
	| "composition_review"
	| "preview"
	| "export"
	| "completed"
	| "error";

const delay = (milliseconds: number) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));
const CLIPPER_MEDIA_STORAGE_KEY = "capinsta:clipper:active-media-v1";

function formatTime(milliseconds: number): string {
	const seconds = Math.floor(milliseconds / 1000);
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function readRecord({
	value,
	key,
}: {
	value: unknown;
	key: string;
}): Record<string, unknown> | null {
	if (typeof value !== "object" || value === null) return null;
	const field = Reflect.get(value, key);
	return typeof field === "object" && field !== null
		? Object.fromEntries(Object.entries(field))
		: null;
}

function isSafeZone(
	value: string,
): value is ClipperSelection["safeZoneProfile"] {
	return (
		value === "shorts-generic-v1" ||
		value === "tiktok-v1" ||
		value === "reels-v1" ||
		value === "youtube-shorts-v1"
	);
}

function stageFailure(value: unknown): string | null {
	if (typeof value !== "object" || value === null) return null;
	if (Reflect.get(value, "status") === "failed") {
		const message = Reflect.get(value, "failureMessage");
		return typeof message === "string" ? message : "A processing stage failed.";
	}
	for (const nested of Object.values(value)) {
		const failure = stageFailure(nested);
		if (failure) return failure;
	}
	return null;
}

export function ClipperWorkspace() {
	const [state, setState] = useState<WorkspaceState>("upload");
	const [uploadProgress, setUploadProgress] = useState(0);
	const [workflow, setWorkflow] = useState<WorkflowSnapshot | null>(null);
	const [candidates, setCandidates] = useState<ViralCandidate[]>([]);
	const [selected, setSelected] = useState<ViralCandidate | null>(null);
	const [hookText, setHookText] = useState("");
	const [emojiText, setEmojiText] = useState("");
	const [layout, setLayout] = useState<ClipperLayoutStrategy>("automatic");
	const [captionPreset, setCaptionPreset] = useState("word_highlight_box");
	const [wordSpacing, setWordSpacing] = useState(8);
	const [safeZone, setSafeZone] = useState<
		"shorts-generic-v1" | "tiktok-v1" | "reels-v1" | "youtube-shorts-v1"
	>("shorts-generic-v1");
	const [projectRevision, setProjectRevision] = useState<number | null>(null);
	const [previewReady, setPreviewReady] = useState(false);
	const [exportId, setExportId] = useState<string | null>(null);
	const [exportProgress, setExportProgress] = useState(0);
	const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
	const [message, setMessage] = useState("");
	const [error, setError] = useState("");
	const abortRef = useRef<AbortController | null>(null);
	const selectedFileRef = useRef<File | null>(null);
	const pauseRequestedRef = useRef(false);

	const projectId = workflow?.projectId ?? null;
	const stages = useMemo(
		() => Object.entries(workflow?.stages ?? {}),
		[workflow?.stages],
	);

	const fail = useCallback((caught: unknown) => {
		setError(
			caught instanceof Error
				? caught.message
				: "The clipper could not continue.",
		);
		setState("error");
	}, []);

	const pollWorkflow = useCallback(async (mediaAssetId: string) => {
		for (let attempt = 0; attempt < 3_600; attempt += 1) {
			const snapshot = await advanceWorkflow(mediaAssetId);
			setWorkflow(snapshot);
			const failure = stageFailure(snapshot.stages);
			if (failure) throw new Error(failure);
			if (snapshot.status === "candidate_review" && snapshot.projectId) {
				setCandidates(await listCandidates(snapshot.projectId));
				setProjectRevision(snapshot.projectRevision);
				setState("candidate_review");
				return;
			}
			await delay(2_000);
		}
		throw new Error("Processing exceeded the configured polling window.");
	}, []);

	const upload = async (file: File) => {
		abortRef.current?.abort();
		selectedFileRef.current = file;
		pauseRequestedRef.current = false;
		abortRef.current = new AbortController();
		setState("processing");
		setMessage("Uploading source video…");
		try {
			const mediaAssetId = await uploadClipperMedia({
				file,
				onProgress: setUploadProgress,
				signal: abortRef.current.signal,
			});
			window.localStorage.setItem(CLIPPER_MEDIA_STORAGE_KEY, mediaAssetId);
			setMessage(
				"Processing, transcribing and finding your strongest moments…",
			);
			await pollWorkflow(mediaAssetId);
		} catch (caught) {
			if (pauseRequestedRef.current) return;
			fail(caught);
		}
	};

	const choose = (candidate: ViralCandidate) => {
		setSelected(candidate);
		setHookText(candidate.hookText || candidate.title);
		setEmojiText(candidate.supportingEmojis.join(" "));
		setLayout(candidate.recommendedFramingStrategy);
		setCaptionPreset(candidate.recommendedCaptionPreset);
		setState("composition_review");
	};

	const waitForJob = async (jobId: string) => {
		if (!projectId) throw new Error("The clipping project is unavailable.");
		for (let attempt = 0; attempt < 1_800; attempt += 1) {
			const job = await getProjectJob(projectId, jobId);
			if (job.status === "succeeded") return job;
			if (["failed", "cancelled", "expired"].includes(job.status)) {
				throw new Error(
					job.failure_message || `${job.status} job could not finish.`,
				);
			}
			await delay(1_500);
		}
		throw new Error("The processing job exceeded its polling window.");
	};

	const generateComposition = async () => {
		if (!projectId || !selected || projectRevision === null) return;
		setMessage("Analyzing scenes and framing the Short…");
		setState("processing");
		try {
			const queued = await selectCandidate(projectId, selected.candidateId, {
				expectedRevision: projectRevision,
				hookText,
				supportingEmojis: emojiText.trim()
					? emojiText.trim().split(/\s+/).slice(0, 2)
					: [],
				framingStrategy: layout,
				captionPreset,
				wordSpacing,
				safeZoneProfile: safeZone,
			});
			const selectedRevision = queued.jobId
				? (await waitForJob(queued.jobId)).output?.projectRevision
				: queued.projectRevision;
			if (!selectedRevision)
				throw new Error("Composition revision is unavailable.");
			setProjectRevision(selectedRevision);
			setMessage("Deriving the editable timeline…");
			for (let attempt = 0; attempt < 600; attempt += 1) {
				const status = await getProjectStatus(projectId);
				const derivation = readRecord({
					value: status,
					key: "derivation",
				});
				if (derivation?.status === "succeeded" && derivation.edl === "current")
					break;
				if (derivation?.status === "failed") {
					throw new Error("Timeline derivation failed.");
				}
				await delay(1_500);
			}
			setMessage("Preparing the editable Capinsta project…");
			const targetProjectId = `clipper-${projectId}`;
			const conversion = await requestConversion(
				projectId,
				selectedRevision,
				targetProjectId,
			);
			await waitForJob(conversion.jobId);
			setState("preview");
			setMessage("");
		} catch (caught) {
			fail(caught);
		}
	};

	const preview = async () => {
		if (!projectId || projectRevision === null) return;
		const previewWindow = window.open("about:blank", "_blank", "noopener");
		try {
			await preparePreview(projectId, projectRevision);
			const handoff = await prepareHandoff(
				projectId,
				projectRevision,
				`clipper-preview-${projectId}`,
			);
			if (previewWindow) {
				previewWindow.location.assign(`/editor/handoff/${handoff.handoffId}`);
			} else {
				window.location.assign(`/editor/handoff/${handoff.handoffId}`);
			}
			setPreviewReady(true);
		} catch (caught) {
			previewWindow?.close();
			fail(caught);
		}
	};

	const startExport = async () => {
		if (!projectId || projectRevision === null) return;
		setState("export");
		try {
			const created = await createExport(projectId, projectRevision);
			setExportId(created.exportId);
			for (let attempt = 0; attempt < 3_600; attempt += 1) {
				const status = await getExport(created.exportId);
				const progress = Reflect.get(status, "progress");
				if (typeof progress === "number") setExportProgress(progress);
				const exportStatus = Reflect.get(status, "status");
				if (exportStatus === "ready") {
					setDownloadUrl(await getExportDownload(created.exportId));
					setState("completed");
					return;
				}
				if (["failed", "cancelled", "expired"].includes(String(exportStatus))) {
					throw new Error(`Export ${String(exportStatus)}.`);
				}
				await delay(2_000);
			}
			throw new Error("Export exceeded its polling window.");
		} catch (caught) {
			fail(caught);
		}
	};

	const openInCapinsta = async () => {
		if (!projectId || projectRevision === null) return;
		try {
			const handoff = await prepareHandoff(
				projectId,
				projectRevision,
				`clipper-${projectId}`,
			);
			window.location.assign(`/editor/handoff/${handoff.handoffId}`);
		} catch (caught) {
			fail(caught);
		}
	};

	useEffect(() => {
		const mediaAssetId = window.localStorage.getItem(CLIPPER_MEDIA_STORAGE_KEY);
		if (mediaAssetId) {
			queueMicrotask(() => {
				setState("processing");
				setMessage("Restoring your private clipping workflow…");
				void pollWorkflow(mediaAssetId).catch(fail);
			});
		}
		return () => {
			abortRef.current?.abort();
		};
	}, [fail, pollWorkflow]);

	return (
		<div className="marketing-theme min-h-screen bg-background bg-grid-paper text-foreground">
			<header className="flex h-16 items-center justify-between border-b-2 border-border bg-card px-5 shadow-[0_3px_0_var(--shadow-strong)]">
				<div className="flex items-center gap-3">
					<Link href="/projects">
						<LogoStatic variant="mark" height={28} alt="Capinsta" />
					</Link>
					<div>
						<p className="font-black">Automatic Clipper</p>
						<p className="text-xs text-muted-foreground">
							Private 9:16 Short workflow
						</p>
					</div>
				</div>
				<AccountMenu compact />
			</header>
			<main className="mx-auto max-w-6xl px-4 py-8">
				{state === "upload" && (
					<Card className="mx-auto max-w-2xl border-2">
						<CardHeader>
							<CardTitle>Turn a long video into editable Shorts</CardTitle>
						</CardHeader>
						<CardContent className="space-y-5">
							<p className="text-sm text-muted-foreground">
								Upload MP4, MOV or WebM. Landscape, square and vertical sources
								are supported.
							</p>
							<Input
								type="file"
								accept="video/mp4,video/quicktime,video/webm"
								onChange={(event) => {
									const file = event.target.files?.[0];
									if (file) void upload(file);
								}}
							/>
						</CardContent>
					</Card>
				)}

				{state === "processing" && (
					<Card className="mx-auto max-w-3xl border-2">
						<CardHeader>
							<CardTitle>{message || "Processing your video…"}</CardTitle>
						</CardHeader>
						<CardContent className="space-y-5">
							{uploadProgress < 100 && <Progress value={uploadProgress} />}
							{uploadProgress < 100 && (
								<Button
									variant="outline"
									onClick={() => {
										pauseRequestedRef.current = true;
										abortRef.current?.abort();
										setState("paused");
									}}
								>
									Pause upload
								</Button>
							)}
							<div className="grid gap-2 sm:grid-cols-2">
								{stages.map(([name, value]) => (
									<div key={name} className="rounded-sm border p-3 text-sm">
										<span className="font-bold capitalize">{name}</span>
										<span className="float-right text-muted-foreground">
											{String(
												typeof value === "object" && value !== null
													? (Reflect.get(value, "status") ?? "working")
													: "working",
											)}
										</span>
									</div>
								))}
							</div>
						</CardContent>
					</Card>
				)}

				{state === "paused" && (
					<Card className="mx-auto max-w-2xl border-2">
						<CardHeader>
							<CardTitle>Upload paused</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
							<Progress value={uploadProgress} />
							<Button
								onClick={() => {
									const file = selectedFileRef.current;
									if (file) void upload(file);
								}}
							>
								Resume upload
							</Button>
						</CardContent>
					</Card>
				)}

				{state === "candidate_review" && (
					<div className="space-y-5">
						<div>
							<h1 className="text-3xl font-black">Ranked moments</h1>
							<p className="text-muted-foreground">
								Scores are editorial signals, not guarantees of virality.
							</p>
						</div>
						<div className="grid gap-4 md:grid-cols-2">
							{candidates.length === 0 && (
								<Card className="border-2 md:col-span-2">
									<CardContent className="space-y-3 pt-6">
										<p className="font-bold">
											No suitable self-contained moment was found.
										</p>
										<p className="text-sm text-muted-foreground">
											You can retry candidate analysis. The clipper will never
											invent a range or word timing.
										</p>
										<Button
											onClick={() => {
												if (projectId && projectRevision !== null) {
													setState("processing");
													setMessage("Regenerating ranked moments…");
													void regenerateCandidates(projectId, projectRevision)
														.then(
															() =>
																workflow && pollWorkflow(workflow.mediaAssetId),
														)
														.catch(fail);
												}
											}}
										>
											Regenerate candidates
										</Button>
									</CardContent>
								</Card>
							)}
							{candidates.map((candidate) => (
								<Card key={candidate.candidateId} className="border-2">
									<CardHeader>
										<div className="flex items-start justify-between gap-3">
											<CardTitle>{candidate.title}</CardTitle>
											<span className="rounded-full bg-primary px-3 py-1 text-sm font-black text-primary-foreground">
												{candidate.viralScore}
											</span>
										</div>
									</CardHeader>
									<CardContent className="space-y-3">
										<p className="text-sm font-bold">
											{formatTime(candidate.sourceStartMs)}–
											{formatTime(candidate.sourceEndMs)}
											{" · "}
											{Math.round(candidate.durationMs / 1000)} sec
										</p>
										<p className="text-lg font-black">
											{candidate.hookText}{" "}
											{candidate.supportingEmojis.join(" ")}
										</p>
										<p className="text-sm">
											{candidate.transcriptEvidence.excerpt}
										</p>
										<p className="text-xs text-muted-foreground">
											{candidate.reason}
										</p>
										<div className="flex gap-2">
											<Button onClick={() => choose(candidate)}>
												Customize
											</Button>
											<Button
												variant="outline"
												onClick={() => {
													if (projectId && projectRevision !== null) {
														void rejectCandidate(
															projectId,
															candidate.candidateId,
															projectRevision,
														).then(
															() =>
																setCandidates((items) =>
																	items.filter(
																		(item) =>
																			item.candidateId !==
																			candidate.candidateId,
																	),
																),
															fail,
														);
													}
												}}
											>
												Reject
											</Button>
										</div>
									</CardContent>
								</Card>
							))}
						</div>
					</div>
				)}

				{state === "composition_review" && selected && (
					<Card className="mx-auto max-w-3xl border-2">
						<CardHeader>
							<CardTitle>Compose “{selected.title}”</CardTitle>
						</CardHeader>
						<CardContent className="grid gap-5 sm:grid-cols-2">
							<div className="space-y-2 sm:col-span-2">
								<Label htmlFor="clipper-hook">Hook</Label>
								<Input
									id="clipper-hook"
									value={hookText}
									onChange={(event) => setHookText(event.target.value)}
									maxLength={120}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="clipper-emojis">
									Supporting emojis (max 2)
								</Label>
								<Input
									id="clipper-emojis"
									value={emojiText}
									onChange={(event) => setEmojiText(event.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label>Framing</Label>
								<Select
									value={layout}
									onValueChange={(value) => {
										if (isClipperLayoutStrategy(value)) setLayout(value);
									}}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="automatic">Automatic</SelectItem>
										<SelectItem value="preserve_vertical">
											Preserve vertical
										</SelectItem>
										<SelectItem value="single_subject_crop">
											Single subject
										</SelectItem>
										<SelectItem value="dual_subject_split">
											Dual subject split
										</SelectItem>
										<SelectItem value="speaker_screen_stack">
											Speaker + screen
										</SelectItem>
										<SelectItem value="fit_blurred_background">
											Fit + blurred background
										</SelectItem>
										<SelectItem value="manual_safe_crop">
											Manual safe crop
										</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-2">
								<Label>Caption preset</Label>
								<Select value={captionPreset} onValueChange={setCaptionPreset}>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="word_highlight_box">
											Word highlight box
										</SelectItem>
										<SelectItem value="viral_word_highlight">
											Viral word highlight
										</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-2">
								<Label htmlFor="clipper-word-spacing">Word spacing</Label>
								<Input
									id="clipper-word-spacing"
									type="number"
									min={-10}
									max={100}
									value={wordSpacing}
									onChange={(event) =>
										setWordSpacing(Number(event.target.value))
									}
								/>
							</div>
							<div className="space-y-2">
								<Label>Safe zone</Label>
								<Select
									value={safeZone}
									onValueChange={(value) => {
										if (isSafeZone(value)) setSafeZone(value);
									}}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="shorts-generic-v1">
											Generic Short
										</SelectItem>
										<SelectItem value="tiktok-v1">TikTok</SelectItem>
										<SelectItem value="reels-v1">Reels</SelectItem>
										<SelectItem value="youtube-shorts-v1">
											YouTube Shorts
										</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div className="flex gap-2 sm:col-span-2">
								<Button onClick={() => void generateComposition()}>
									Generate composition
								</Button>
								<Button
									variant="outline"
									onClick={() => setState("candidate_review")}
								>
									Back
								</Button>
							</div>
						</CardContent>
					</Card>
				)}

				{state === "preview" && (
					<Card className="mx-auto max-w-3xl border-2">
						<CardHeader>
							<CardTitle>Composition ready</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
							<p>The 9:16 project is revision-bound, captioned and editable.</p>
							{previewReady && (
								<p className="rounded-sm border border-green-600 bg-green-500/10 p-3 text-sm">
									Revision-bound preview opened in the editable Capinsta
									workspace.
								</p>
							)}
							<div className="flex flex-wrap gap-2">
								<Button onClick={() => void preview()}>
									Preview in Capinsta
								</Button>
								<Button onClick={() => void startExport()}>Export MP4</Button>
								<Button variant="outline" onClick={() => void openInCapinsta()}>
									Open in Capinsta
								</Button>
							</div>
						</CardContent>
					</Card>
				)}

				{state === "export" && (
					<Card className="mx-auto max-w-2xl border-2">
						<CardHeader>
							<CardTitle>Rendering MP4</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
							<Progress value={exportProgress} />
							<Button
								variant="outline"
								onClick={() => {
									if (exportId) void cancelExport(exportId);
								}}
							>
								Cancel export
							</Button>
						</CardContent>
					</Card>
				)}

				{state === "completed" && (
					<Card className="mx-auto max-w-2xl border-2">
						<CardHeader>
							<CardTitle>Your Short is ready</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-wrap gap-3">
							{downloadUrl && (
								<Button asChild>
									<a href={downloadUrl}>Download MP4</a>
								</Button>
							)}
							<Button variant="outline" onClick={() => void openInCapinsta()}>
								Open editable project
							</Button>
						</CardContent>
					</Card>
				)}

				{state === "error" && (
					<Card className="mx-auto max-w-2xl border-2 border-destructive">
						<CardHeader>
							<CardTitle>
								{error.startsWith("Video exceeds the Storage limit")
									? "Video exceeds the Storage limit"
									: "Clipper needs attention"}
							</CardTitle>
						</CardHeader>
						<CardContent className="space-y-4">
							<p>{error}</p>
							{error.startsWith("Video exceeds the Storage limit") && (
								<p className="text-sm text-muted-foreground">
									Admins: Supabase Dashboard â†’ Storage â†’ Settings â†’
									Global file size limit, then Storage â†’ source-media â†’
									Edit bucket â†’ File size limit.
								</p>
							)}
							<div className="flex gap-2">
								<Button onClick={() => window.location.reload()}>
									Try again
								</Button>
								<Button
									variant="outline"
									onClick={async () => {
										try {
											await discardClipperUpload(selectedFileRef.current);
										} finally {
											window.localStorage.removeItem(CLIPPER_MEDIA_STORAGE_KEY);
											window.location.reload();
										}
									}}
								>
									{error.startsWith("Video exceeds the Storage limit")
										? "Choose a smaller video"
										: "Start another video"}
								</Button>
							</div>
						</CardContent>
					</Card>
				)}
			</main>
		</div>
	);
}
