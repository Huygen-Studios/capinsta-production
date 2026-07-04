import { Button } from "@/components/ui/button";
import { EditorHelpButton } from "@/components/editor/editor-help-button";
import { EDITOR_HELP_CONTENT } from "@/components/editor/editor-help-content";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useEditor } from "@/editor/use-editor";
import { TRANSCRIPTION_DIAGNOSTICS_SCOPE } from "@/transcription/diagnostics";
import { TRANSCRIPTION_LANGUAGES } from "@/transcription/supported-languages";
import type { TranscriptionLanguage } from "@/transcription/types";
import type { CapinstaCaptionOutput } from "@/capinsta/types";
import type { SubtitleCue } from "@/subtitles/types";
import { insertCaptionChunksAsTextTrack } from "@/subtitles/insert";
import { parseSubtitleFile } from "@/subtitles/parse";
import { sampleCapinstaTranscriptV1 } from "@/capinsta/sampleTranscript";
import { ensureAudioForCaptions } from "@/capinsta/audioForCaptions";
import { resolveCaptionUploadFile } from "@/capinsta/captionMediaAsset";
import {
	captionJobButtonLabel,
	captionJobReducer,
	IDLE_CAPTION_JOB_STATE,
	isCaptionJobRunning,
} from "@/capinsta/captionJobState";
import {
	getCapinstaApiBaseUrl,
	getCapinstaJobPollIntervalMs,
	getCapinstaJobTimeoutMs,
	isAiCaptionsEnabled,
	isCapinstaDebugEnabled,
} from "@/capinsta/featureFlags";
import { usePublicRuntimeFlag } from "@/admin/use-public-runtime-flag";
import { capinstaTranscriptToOpenCutSubtitleImport } from "@/capinsta/opencutClassicAdapter";
import { buildCapinstaCaptionTimingDiagnostics } from "@/capinsta/adapter";
import { rememberCapinstaCaptionDocument } from "@/capinsta/captionDocumentRegistry";
import {
	cancelCapinstaJob,
	checkCapinstaHealth,
	normalizeCapinstaJobToTranscript,
	startCapinstaCaptionJob,
} from "@/capinsta/apiClient";
import { pollCapinstaJobUntilDone } from "@/capinsta/jobPolling";
import { Spinner } from "@/components/ui/spinner";
import {
	Section,
	SectionContent,
	SectionField,
	SectionFields,
} from "@/components/section";
import {
	AlertCircleIcon,
	CloudUploadIcon,
	MagicWand05Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { DiagnosticSeverity } from "@/diagnostics/types";
import { DownloadIcon, MoreVerticalIcon } from "lucide-react";
import {
	ToggleTrackVisibilityCommand,
	UpdateCapinstaCaptionDocumentCommand,
} from "@/commands";
import { formatSubtitleTime } from "@/capinsta/captionEditing";
import { storageService } from "@/services/storage/service";

const DIAGNOSTIC_BUTTON_VARIANT: Record<
	DiagnosticSeverity,
	"caution" | "destructive-foreground"
> = {
	caution: "caution",
	error: "destructive-foreground",
};

function getBackendCaptionProgressState({
	status,
}: {
	status: string | null | undefined;
}): {
	status:
		| "preparing"
		| "extracting_audio"
		| "transcribing"
		| "generating_captions"
		| "importing_captions";
	message: string;
} {
	switch ((status ?? "").trim().toLowerCase()) {
		case "uploaded":
		case "queued":
		case "pending":
		case "started":
		case "running":
		case "processing":
			return { status: "transcribing", message: "Transcribing speech..." };
		case "extracting":
		case "extracting_audio":
			return { status: "extracting_audio", message: "Extracting audio..." };
		case "transcribing":
			return { status: "transcribing", message: "Transcribing speech..." };
		case "romanizing":
			return {
				status: "transcribing",
				message: "Normalizing transcript text...",
			};
		case "aligning":
			return { status: "transcribing", message: "Aligning word timings..." };
		case "normalizing":
		case "chunking":
		case "generating_captions":
		case "rendering":
		case "rendering_captions":
		case "finalizing":
		case "saving":
			return {
				status: "generating_captions",
				message: "Building editable captions...",
			};
		case "importing_captions":
			return {
				status: "importing_captions",
				message: "Importing captions into timeline...",
			};
		default:
			return { status: "transcribing", message: "Transcribing speech..." };
	}
}

type ProcessingState =
	| { status: "idle"; error: string | null; warnings: string[] }
	| { status: "processing"; step: string };

type ProcessingAction =
	| { type: "start"; step: string }
	| { type: "update_step"; step: string }
	| { type: "succeed"; warnings: string[] }
	| { type: "fail"; error: string };

const IDLE_STATE: ProcessingState = {
	status: "idle",
	error: null,
	warnings: [],
};

/* eslint-disable opencut/prefer-object-params -- React reducers must accept (state, action). */
function processingReducer(
	state: ProcessingState,
	action: ProcessingAction,
): ProcessingState {
	switch (action.type) {
		case "start":
			return { status: "processing", step: action.step };
		case "update_step":
			if (state.status !== "processing") return state;
			return { status: "processing", step: action.step };
		case "succeed":
			return { status: "idle", error: null, warnings: action.warnings };
		case "fail":
			return { status: "idle", error: action.error, warnings: [] };
	}
}
/* eslint-enable opencut/prefer-object-params */

export function Captions() {
	const [selectedAudioLanguage, setSelectedAudioLanguage] =
		useState<TranscriptionLanguage>("auto");
	const [selectedCaptionOutput, setSelectedCaptionOutput] =
		useState<CapinstaCaptionOutput>("original");
	const [captionJob, dispatchCaptionJob] = useReducer(
		captionJobReducer,
		IDLE_CAPTION_JOB_STATE,
	);
	const [importProcessing, dispatchImportProcessing] = useReducer(
		processingReducer,
		IDLE_STATE,
	);
	const [warnings, setWarnings] = useState<string[]>([]);
	const [deleteAllOpen, setDeleteAllOpen] = useState(false);
	const [showSpeakers, setShowSpeakers] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const captionJobRunningRef = useRef(false);
	const abortControllerRef = useRef<AbortController | null>(null);
	const previousSelectedMediaValueRef = useRef("");
	const editor = useEditor();
	const captionRecords = useEditor(
		(e) => e.project.getActive().capinstaCaptionDocuments ?? [],
	);
	const activeCaptionRecord = captionRecords[0] ?? null;
	const captionTrackHidden = useEditor((e) => {
		const record = e.project.getActive().capinstaCaptionDocuments?.[0];
		if (!record) return false;
		const track = e.scenes
			.getActiveScene()
			.tracks.overlay.find(
				(candidate) => candidate.id === record.openCutTrackId,
			);
		return Boolean(track && "hidden" in track && track.hidden);
	});
	const isSampleImportEnabled = usePublicRuntimeFlag({
		key: "sample_import_enabled",
	});
	const isAiCaptionGenerationEnabled = isAiCaptionsEnabled();
	const isCapinstaDebug = isCapinstaDebugEnabled();
	const capinstaApiBaseUrl = getCapinstaApiBaseUrl();
	const capinstaJobTimeoutMs = getCapinstaJobTimeoutMs();
	const capinstaJobPollIntervalMs = getCapinstaJobPollIntervalMs();
	const mediaAssets = useEditor((e) => e.media.getAssets());
	const captionCandidateAssets = useMemo(
		() =>
			mediaAssets.filter(
				(asset) => asset.type === "video" || asset.type === "audio",
			),
		[mediaAssets],
	);
	const [selectedMediaId, setSelectedMediaId] = useState<string>("");

	const isCaptionProcessing = isCaptionJobRunning(captionJob.status);
	const isImportProcessing = importProcessing.status === "processing";
	const isProcessing = isCaptionProcessing || isImportProcessing;

	const activeDiagnostics = useEditor((e) =>
		e.diagnostics.getActive({ scope: TRANSCRIPTION_DIAGNOSTICS_SCOPE }),
	);

	const selectedMediaAsset =
		captionCandidateAssets.find((asset) => asset.id === selectedMediaId) ??
		captionCandidateAssets[0] ??
		null;
	const selectedMediaValue = selectedMediaAsset?.id ?? "";
	const isSelectedMediaUploadable =
		selectedMediaAsset?.type === "video" &&
		/\.(mp4|mov|m4v|webm)$/i.test(selectedMediaAsset.file.name);
	const aiCaptionDisabledReason = !selectedMediaAsset
		? "Select an imported local video file to generate captions."
		: !isSelectedMediaUploadable
			? "Select an imported local MP4, MOV, or WebM video file to generate captions."
			: !capinstaApiBaseUrl
				? "Set NEXT_PUBLIC_CAPINSTA_API_BASE_URL to generate captions."
				: null;

	useEffect(() => {
		return () => {
			abortControllerRef.current?.abort();
		};
	}, []);

	useEffect(() => {
		if (previousSelectedMediaValueRef.current === selectedMediaValue) return;
		previousSelectedMediaValueRef.current = selectedMediaValue;
		if (!captionJobRunningRef.current) return;
		abortControllerRef.current?.abort();
		captionJobRunningRef.current = false;
		dispatchCaptionJob({
			type: "error",
			message: "Caption generation cancelled because selected media changed.",
		});
	}, [selectedMediaValue]);

	const insertCaptions = ({
		captions,
	}: {
		captions: SubtitleCue[];
	}): boolean => {
		const trackId = insertCaptionChunksAsTextTrack({ editor, captions });
		return trackId !== null;
	};

	const handleImportSampleCaptions = (event: React.MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		setWarnings([]);
		dispatchImportProcessing({
			type: "start",
			step: "Importing sample captions...",
		});
		try {
			const result = capinstaTranscriptToOpenCutSubtitleImport(
				sampleCapinstaTranscriptV1,
			);
			const trackId = insertCaptionChunksAsTextTrack({
				editor,
				captions: result.captions,
				capinstaDocument: result.document,
			});

			if (trackId === null) {
				dispatchImportProcessing({
					type: "fail",
					error: "No sample captions were generated",
				});
				return;
			}

			const record = rememberCapinstaCaptionDocument({
				document: result.document,
				openCutTrackId: trackId,
			});
			editor.project.addCapinstaCaptionDocument({ record });

			dispatchImportProcessing({
				type: "succeed",
				warnings: [
					`Imported Capinsta sample captions from ${result.source.sourceAssetName}.`,
				],
			});
		} catch (error) {
			console.error("Capinsta sample caption import failed:", error);
			dispatchImportProcessing({
				type: "fail",
				error:
					error instanceof Error
						? error.message
						: "An unexpected error occurred",
			});
		}
	};

	const cacheAudioMetadata = ({
		videoAssetId,
		extractedAudioAssetId,
		audioExtractionStatus,
		duration,
	}: {
		videoAssetId: string;
		extractedAudioAssetId: string;
		audioExtractionStatus: "ready";
		duration?: number;
	}) => {
		editor.media.setAssets({
			assets: editor.media.getAssets().map((asset) =>
				asset.id === videoAssetId
					? {
							...asset,
							hasAudio: asset.hasAudio ?? true,
							extractedAudioAssetId,
							audioExtractionStatus,
							sourceAssetId: videoAssetId,
							duration: asset.duration ?? duration,
						}
					: asset,
			),
		});
	};

	const handleGenerateAiCaptions = async (event: React.MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		if (captionJobRunningRef.current) {
			console.debug("[Capinsta captions] Caption generation already running");
			return;
		}
		if (!selectedMediaAsset || !isSelectedMediaUploadable) {
			dispatchCaptionJob({
				type: "error",
				message:
					aiCaptionDisabledReason ??
					"Select an imported local video file to generate captions.",
			});
			return;
		}
		if (!capinstaApiBaseUrl) {
			dispatchCaptionJob({
				type: "error",
				message: "Set NEXT_PUBLIC_CAPINSTA_API_BASE_URL to generate captions.",
			});
			return;
		}

		const abortController = new AbortController();
		abortControllerRef.current = abortController;
		captionJobRunningRef.current = true;
		setWarnings([]);
		dispatchCaptionJob({
			type: "start",
			status: "preparing",
			message: "Preparing media...",
		});
		try {
			console.debug("[Capinsta captions] Selected media", {
				id: selectedMediaAsset.id,
				name: selectedMediaAsset.name,
			});
			await checkCapinstaHealth({
				baseUrl: capinstaApiBaseUrl,
				signal: abortController.signal,
			});

			dispatchCaptionJob({
				type: "progress",
				status: "extracting_audio",
				message: "Extracting audio...",
			});
			console.debug("[Capinsta captions] Ensuring reusable audio source");
			const audioForCaptions = await ensureAudioForCaptions({
				videoAssetId: selectedMediaAsset.id,
				getAssets: () => editor.media.getAssets(),
				cacheAudioMetadata,
			});
			console.debug("[Capinsta captions] Audio source ready", {
				assetId: audioForCaptions.assetId,
				sourceAssetId: audioForCaptions.sourceAssetId,
				wasReused: audioForCaptions.wasReused,
			});

			dispatchCaptionJob({
				type: "progress",
				status: "transcribing",
				message: "Transcribing speech...",
			});
			console.debug("[Capinsta captions] Starting transcription request");
			const projectId = editor.project.getActive().metadata.id;
			const captionUploadFile = await resolveCaptionUploadFile({
				projectId,
				mediaAsset: selectedMediaAsset,
				loadMediaAsset: (args) => storageService.loadMediaAsset(args),
			});
			const startedJob = await startCapinstaCaptionJob({
				baseUrl: capinstaApiBaseUrl,
				file: captionUploadFile,
				projectId,
				languageMode: selectedAudioLanguage,
				captionOutput: selectedCaptionOutput,
				signal: abortController.signal,
			});
			await editor.project.setCapinstaServerJobId({
				jobId: startedJob.job_id,
			});
			dispatchCaptionJob({
				type: "progress",
				status: "transcribing",
				message: "Transcribing speech...",
				activeJobId: startedJob.job_id,
			});

			const completedJob = await pollCapinstaJobUntilDone({
				baseUrl: capinstaApiBaseUrl,
				jobId: startedJob.job_id,
				intervalMs: capinstaJobPollIntervalMs,
				maxElapsedMs: capinstaJobTimeoutMs,
				signal: abortController.signal,
				onProgress: (job) => {
					const progress =
						typeof job.progress === "number" && job.progress >= 0
							? job.progress
							: null;
					const progressState = getBackendCaptionProgressState({
						status: job.status,
					});
					dispatchCaptionJob({
						type: "progress",
						status: progressState.status,
						message:
							job.message ||
							job.details ||
							(progress
								? `${progressState.message} ${progress}%`
								: progressState.message),
						progressPercent: progress,
						activeJobId: startedJob.job_id,
					});
				},
				onStatusHistory: (history) => {
					const latest = history.at(-1);
					const unknownStatus =
						latest?.normalizedStatus === "unknown"
							? latest.rawStatus || "(empty)"
							: null;
					dispatchCaptionJob({
						type: "status_history",
						history,
						debugWarning:
							isCapinstaDebug && unknownStatus
								? `Unknown backend status "${unknownStatus}" is being treated as processing.`
								: null,
					});
				},
			});
			console.debug("[Capinsta captions] Transcription completed", {
				jobId: completedJob.job_id,
			});
			dispatchCaptionJob({
				type: "progress",
				status: "generating_captions",
				message: "Building editable captions...",
				progressPercent: 90,
			});
			const transcript = normalizeCapinstaJobToTranscript({
				job: completedJob,
				sourceAsset: {
					assetId: selectedMediaAsset.id,
					assetName: selectedMediaAsset.name,
					durationSeconds: selectedMediaAsset.duration,
					mimeType: selectedMediaAsset.file.type,
				},
			});
			const result = capinstaTranscriptToOpenCutSubtitleImport(transcript);
			if (process.env.NODE_ENV === "development") {
				console.debug(
					"[Capinsta captions] Generated caption timing",
					buildCapinstaCaptionTimingDiagnostics(result.document),
				);
			}
			dispatchCaptionJob({
				type: "progress",
				status: "importing_captions",
				message: "Importing captions into timeline...",
				progressPercent: 95,
			});
			const trackId = insertCaptionChunksAsTextTrack({
				editor,
				captions: result.captions,
				capinstaDocument: result.document,
			});

			if (trackId === null) {
				dispatchCaptionJob({
					type: "error",
					message: "No captions were generated",
				});
				return;
			}

			const record = rememberCapinstaCaptionDocument({
				document: result.document,
				openCutTrackId: trackId,
			});
			editor.project.addCapinstaCaptionDocument({ record });
			console.debug("[Capinsta captions] Captions imported", {
				trackId,
				captionCount: result.captions.length,
			});

			setWarnings([`Generated AI captions for ${selectedMediaAsset.name}.`]);
			dispatchCaptionJob({
				type: "done",
				message: "Done",
			});
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") {
				dispatchCaptionJob({
					type: "error",
					message: "Caption generation cancelled.",
				});
				return;
			}
			console.error("Capinsta AI caption generation failed:", error);
			dispatchCaptionJob({
				type: "error",
				message:
					error instanceof Error
						? error.message
						: "An unexpected error occurred",
			});
		} finally {
			captionJobRunningRef.current = false;
			if (abortControllerRef.current === abortController) {
				abortControllerRef.current = null;
			}
		}
	};

	const handleCancelCaptionJob = async (event: React.MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		const jobId = captionJob.activeJobId;
		abortControllerRef.current?.abort();
		captionJobRunningRef.current = false;
		if (jobId && capinstaApiBaseUrl) {
			try {
				await cancelCapinstaJob({
					baseUrl: capinstaApiBaseUrl,
					jobId,
				});
			} catch (error) {
				console.warn("Failed to cancel Capinsta backend job:", error);
			}
		}
		dispatchCaptionJob({
			type: "error",
			message: "Caption generation cancelled.",
		});
	};

	const handleImportClick = (event: React.MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		fileInputRef.current?.click();
	};

	const handleImportFile = async ({ file }: { file: File }) => {
		setWarnings([]);
		dispatchImportProcessing({
			type: "start",
			step: "Reading subtitle file...",
		});
		try {
			const input = await file.text();
			const result = parseSubtitleFile({
				fileName: file.name,
				input,
			});

			if (result.captions.length === 0) {
				dispatchImportProcessing({
					type: "fail",
					error: "No valid subtitle cues were found in the subtitle file",
				});
				return;
			}

			dispatchImportProcessing({
				type: "update_step",
				step: "Importing subtitles...",
			});

			if (!insertCaptions({ captions: result.captions })) {
				dispatchImportProcessing({
					type: "fail",
					error: "No captions were generated",
				});
				return;
			}

			const nextWarnings = [...result.warnings];
			if (result.skippedCueCount > 0) {
				nextWarnings.unshift(
					`Imported ${result.captions.length} subtitle cue(s) and skipped ${result.skippedCueCount} malformed cue(s).`,
				);
			}

			dispatchImportProcessing({
				type: "succeed",
				warnings: nextWarnings,
			});
		} catch (error) {
			console.error("Subtitle import failed:", error);
			dispatchImportProcessing({
				type: "fail",
				error:
					error instanceof Error
						? error.message
						: "An unexpected error occurred",
			});
		}
	};

	const handleFileChange = async ({
		event,
	}: {
		event: React.ChangeEvent<HTMLInputElement>;
	}) => {
		const file = event.target.files?.[0];
		if (event.target) {
			event.target.value = "";
		}
		if (!file) return;

		await handleImportFile({ file });
	};

	const handleLanguageChange = ({ value }: { value: string }) => {
		if (value === "auto") {
			setSelectedAudioLanguage("auto");
			return;
		}

		const matchedLanguage = TRANSCRIPTION_LANGUAGES.find(
			(language) => language.code === value,
		);
		if (!matchedLanguage) return;
		setSelectedAudioLanguage(matchedLanguage.code);
	};

	const handleCaptionOutputChange = ({ value }: { value: string }) => {
		if (
			value === "original" ||
			value === "english" ||
			value === "hindi" ||
			value === "telugu" ||
			value === "hinglish" ||
			value === "telgish"
		) {
			setSelectedCaptionOutput(value);
		}
	};

	const downloadSubtitles = () => {
		if (!activeCaptionRecord) return;
		const body = [...activeCaptionRecord.document.clips]
			.sort((a, b) => a.start - b.start)
			.map(
				(clip, index) =>
					`${index + 1}\n${formatSubtitleTime(clip.start).replace(".", ",")} --> ${formatSubtitleTime(clip.end).replace(".", ",")}\n${clip.text}`,
			)
			.join("\n\n");
		const url = URL.createObjectURL(
			new Blob([`${body}\n`], { type: "application/x-subrip;charset=utf-8" }),
		);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = "subtitles.srt";
		anchor.click();
		URL.revokeObjectURL(url);
	};

	const error =
		captionJob.errorMessage ??
		(importProcessing.status === "idle" ? importProcessing.error : null);
	const allWarnings = [
		...warnings,
		...(importProcessing.status === "idle" ? importProcessing.warnings : []),
	];
	const captionJobLabel = captionJobButtonLabel(captionJob);
	const captionStatusMessage =
		isCaptionProcessing || captionJob.status === "done"
			? captionJob.statusMessage
			: null;
	const languageName = (value: string) =>
		value === "auto"
			? "Auto detect"
			: TRANSCRIPTION_LANGUAGES.find((language) => language.code === value)
					?.name ?? value;
	const outputStatus =
		selectedCaptionOutput === "original"
			? null
			: selectedAudioLanguage === "auto"
				? `Converting captions to ${languageName(selectedCaptionOutput)}`
				: selectedCaptionOutput === "telgish" ||
					  selectedCaptionOutput === "hinglish"
					? `Converting ${languageName(selectedAudioLanguage)} captions to ${languageName(selectedCaptionOutput)}`
					: `Translating ${languageName(selectedAudioLanguage)} captions to ${languageName(selectedCaptionOutput)}`;

	return (
		<PanelView
			title="Captions"
			data-tour="caption-tools"
			contentClassName="px-0 flex flex-col h-full"
			actions={
				<TooltipProvider>
					<div className="flex items-center gap-1.5">
						<EditorHelpButton
							title={EDITOR_HELP_CONTENT.captions.title}
							description={EDITOR_HELP_CONTENT.captions.description}
						/>
						{!isProcessing &&
							activeDiagnostics.map((diagnostic) => (
								<Tooltip key={diagnostic.id}>
									<TooltipTrigger asChild>
										<Button
											type="button"
											variant={DIAGNOSTIC_BUTTON_VARIANT[diagnostic.severity]}
											size="icon"
											aria-label={diagnostic.message}
										>
											<HugeiconsIcon icon={AlertCircleIcon} size={16} />
										</Button>
									</TooltipTrigger>
									<TooltipContent>{diagnostic.message}</TooltipContent>
								</Tooltip>
							))}
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={handleImportClick}
							disabled={isProcessing}
							className="items-center justify-center gap-1.5"
						>
							<HugeiconsIcon icon={CloudUploadIcon} />
							Import
						</Button>
						{activeCaptionRecord ? (
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										aria-label="Subtitle menu"
									>
										<MoreVerticalIcon />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuGroup>
										<DropdownMenuItem
											icon={<DownloadIcon />}
											onSelect={downloadSubtitles}
										>
											Download
										</DropdownMenuItem>
										<DropdownMenuItem
											onSelect={() =>
												editor.command.execute({
													command: new ToggleTrackVisibilityCommand(
														activeCaptionRecord.openCutTrackId,
													),
												})
											}
										>
											{captionTrackHidden ? "Show Subtitles" : "Hide Subtitles"}
										</DropdownMenuItem>
										<DropdownMenuItem
											onSelect={() => setShowSpeakers((value) => !value)}
										>
											{showSpeakers ? "Hide Speakers" : "Show Speakers"}
										</DropdownMenuItem>
										<DropdownMenuItem
											variant="destructive"
											onSelect={() => setDeleteAllOpen(true)}
										>
											Delete Subtitles
										</DropdownMenuItem>
									</DropdownMenuGroup>
								</DropdownMenuContent>
							</DropdownMenu>
						) : null}
					</div>
				</TooltipProvider>
			}
			ref={containerRef}
		>
			<input
				ref={fileInputRef}
				type="file"
				accept=".srt,.ass"
				className="hidden"
				onChange={(event) => void handleFileChange({ event })}
			/>
			<Section
				showTopBorder={false}
				showBottomBorder={false}
				className="flex-1"
			>
				<SectionContent className="flex flex-col gap-4 h-full pt-1">
					<SectionFields>
						{isAiCaptionGenerationEnabled && (
							<SectionField label="Media">
								<Select
									value={selectedMediaValue}
									onValueChange={(value) => setSelectedMediaId(value)}
									disabled={isProcessing || captionCandidateAssets.length === 0}
								>
									<SelectTrigger>
										<SelectValue placeholder="Select media" />
									</SelectTrigger>
									<SelectContent>
										{captionCandidateAssets.map((asset) => (
											<SelectItem key={asset.id} value={asset.id}>
												{asset.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</SectionField>
						)}
						<SectionField label="Audio language">
							<Select
								value={selectedAudioLanguage}
								onValueChange={(value) => handleLanguageChange({ value })}
								disabled={isProcessing}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select audio language" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="auto">Auto detect</SelectItem>
									{TRANSCRIPTION_LANGUAGES.map((language) => (
										<SelectItem key={language.code} value={language.code}>
											{language.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<p className="text-muted-foreground text-xs">
								The language spoken in your video.
							</p>
						</SectionField>
						<SectionField label="Caption output">
							<Select
								value={selectedCaptionOutput}
								onValueChange={(value) => handleCaptionOutputChange({ value })}
								disabled={isProcessing}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select caption output" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="original">Keep original</SelectItem>
									{TRANSCRIPTION_LANGUAGES.map((language) => (
										<SelectItem key={language.code} value={language.code}>
											{language.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<p className="text-muted-foreground text-xs">
								Keep the original language, translate it, or convert it to Roman text.
							</p>
							{outputStatus ? (
								<p className="text-muted-foreground text-xs">{outputStatus}</p>
							) : null}
						</SectionField>
					</SectionFields>

					{isAiCaptionGenerationEnabled && (
						<>
							<Button
								type="button"
								className="mt-auto w-full"
								onClick={(event) => void handleGenerateAiCaptions(event)}
								disabled={
									isProcessing ||
									activeDiagnostics.length > 0 ||
									aiCaptionDisabledReason !== null
								}
							>
								{isCaptionProcessing && <Spinner className="mr-1" />}
								<HugeiconsIcon icon={MagicWand05Icon} className="mr-1" />
								{captionJobLabel}
							</Button>
							{captionStatusMessage && (
								<p className="text-muted-foreground text-xs">
									{captionStatusMessage}
								</p>
							)}
							{isCapinstaDebug && captionJob.debugWarning && (
								<p className="text-amber-600 text-xs">
									{captionJob.debugWarning}
								</p>
							)}
							{isCaptionProcessing && (
								<Button
									type="button"
									variant="outline"
									className="w-full"
									onClick={(event) => void handleCancelCaptionJob(event)}
								>
									Cancel Caption Generation
								</Button>
							)}
							{aiCaptionDisabledReason && (
								<p className="text-muted-foreground text-xs">
									{aiCaptionDisabledReason}
								</p>
							)}
						</>
					)}
					{isSampleImportEnabled && (
						<Button
							type="button"
							variant="outline"
							className="w-full"
							onClick={handleImportSampleCaptions}
							disabled={isProcessing}
						>
							<HugeiconsIcon icon={MagicWand05Icon} className="mr-1" />
							Import Sample Captions
						</Button>
					)}
					{error && (
						<div className="bg-destructive/10 border-destructive/20 rounded-md border p-3">
							<p className="text-destructive text-sm">{error}</p>
						</div>
					)}
					{allWarnings.length > 0 && (
						<div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3">
							<ul className="space-y-1 text-sm text-amber-700">
								{allWarnings.map((warning) => (
									<li key={warning}>{warning}</li>
								))}
							</ul>
						</div>
					)}
				</SectionContent>
			</Section>
			<AlertDialog open={deleteAllOpen} onOpenChange={setDeleteAllOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete all subtitles?</AlertDialogTitle>
						<AlertDialogDescription>
							This removes every subtitle from the timeline, preview, downloads,
							and exports. You can undo the deletion.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (!activeCaptionRecord) return;
								editor.command.execute({
									command: new UpdateCapinstaCaptionDocumentCommand({
										...activeCaptionRecord,
										document: {
											...activeCaptionRecord.document,
											clips: [],
											words: [],
										},
									}),
								});
							}}
						>
							Delete subtitles
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</PanelView>
	);
}
