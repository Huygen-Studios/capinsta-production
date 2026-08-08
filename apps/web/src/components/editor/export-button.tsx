"use client";

import { useRef, useState } from "react";
import { TransitionTopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Check, Copy, Download, Film, Layers3, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/utils/ui";
import { sanitizeClipboardText } from "@/security/clipboard";
import {
	downloadBuffer,
	getExportFileExtension,
	getExportMimeType,
	normalizeExportError,
	type ExportMode,
	type ExportQuality,
} from "@/export";
import { useEditor } from "@/editor/use-editor";
import { DEFAULT_EXPORT_OPTIONS } from "@/export/defaults";
import { normalizeExportHexColor } from "@/export/color";
import { frameRateToFloat } from "@/fps/utils";
import {
	normalizeProjectExportFps,
	resolveExportCanvasSize,
	resolveExportFps,
} from "@/export/project-defaults";

const BACKGROUND_PRESETS = [
	{ label: "Green", value: "#00FF00" },
	{ label: "Black", value: "#000000" },
	{ label: "White", value: "#FFFFFF" },
] as const;

const RESOLUTION_PRESETS = [
	{ label: "1080x1920", detail: "Vertical", width: 1080, height: 1920 },
	{ label: "1920x1080", detail: "Horizontal", width: 1920, height: 1080 },
	{ label: "1080x1080", detail: "Square", width: 1080, height: 1080 },
	{ label: "720x1280", detail: "Fast", width: 720, height: 1280 },
] as const;

const FPS_OPTIONS = [24, 30, 60] as const;
const QUALITY_OPTIONS: Array<{
	value: Extract<ExportQuality, "fast" | "balanced" | "high">;
	label: string;
	description: string;
}> = [
	{ value: "fast", label: "Fast", description: "Quickest render" },
	{ value: "balanced", label: "Balanced", description: "Recommended" },
	{ value: "high", label: "High", description: "Best detail" },
];

export function ExportButton() {
	const [isOpen, setIsOpen] = useState(false);
	const editor = useEditor();
	const activeProject = useEditor((instance) =>
		instance.project.getActiveOrNull(),
	);
	const isExporting = useEditor(
		(instance) => instance.project.getExportState().isExporting,
	);
	const hasProject = Boolean(activeProject);

	const handleOpenChange = (open: boolean) => {
		if (!open && editor.project.getExportState().isExporting) {
			return;
		}
		if (!open) {
			editor.project.clearExportState();
		}
		setIsOpen(open);
	};

	return (
		<Dialog open={isOpen} onOpenChange={handleOpenChange}>
			<button
				type="button"
				data-tour="export"
				className={cn(
					"flex h-9 items-center gap-2 rounded-sm border-2 border-[var(--neo-black)] bg-primary px-4 text-sm font-black text-primary-foreground shadow-[4px_4px_0_var(--shadow-strong)] transition hover:bg-[var(--neo-yellow)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none",
					hasProject ? "cursor-pointer" : "cursor-not-allowed opacity-50",
				)}
				onClick={hasProject ? () => setIsOpen(true) : undefined}
				disabled={!hasProject}
			>
				<HugeiconsIcon icon={TransitionTopIcon} className="size-4" />
				<span>Export</span>
			</button>
			{hasProject ? (
				<ExportDialog
					isOpen={isOpen}
					isExporting={isExporting}
					onOpenChange={handleOpenChange}
				/>
			) : null}
		</Dialog>
	);
}

function ExportDialog({
	isOpen,
	isExporting,
	onOpenChange,
}: {
	isOpen: boolean;
	isExporting: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const editor = useEditor();
	const activeProject = useEditor((instance) => instance.project.getActive());
	const exportState = useEditor((instance) =>
		instance.project.getExportState(),
	);
	const [backgroundColor, setBackgroundColor] = useState(
		DEFAULT_EXPORT_OPTIONS.backgroundColor,
	);
	const [hexInput, setHexInput] = useState(
		DEFAULT_EXPORT_OPTIONS.backgroundColor,
	);
	const [exportMode, setExportMode] = useState<ExportMode>("full_video");
	const [resolutionOverride, setResolutionOverride] = useState<{
		width: number;
		height: number;
	} | null>(null);
	const [fpsOverride, setFpsOverride] = useState<number | null>(null);
	const [quality, setQuality] =
		useState<Extract<ExportQuality, "fast" | "balanced" | "high">>("balanced");
	const [includeAudio, setIncludeAudio] = useState(true);
	const colorInputRef = useRef<HTMLInputElement>(null);

	if (!isOpen) {
		return null;
	}

	const projectCanvasSize = activeProject.settings.canvasSize;
	const selectedResolution = resolveExportCanvasSize({
		projectCanvasSize,
		override: resolutionOverride,
	});
	const projectFps = normalizeProjectExportFps({
		fps: frameRateToFloat(activeProject.settings.fps),
	});
	const fps = resolveExportFps({ projectFps, override: fpsOverride });
	const resolutionOptions = [
		{
			label: `${projectCanvasSize.width}x${projectCanvasSize.height}`,
			detail: "Project",
			width: projectCanvasSize.width,
			height: projectCanvasSize.height,
			isProject: true,
		},
		...RESOLUTION_PRESETS.filter(
			(preset) =>
				preset.width !== projectCanvasSize.width ||
				preset.height !== projectCanvasSize.height,
		).map((preset) => ({ ...preset, isProject: false })),
	];
	const fpsOptions = [
		{ value: projectFps, isProject: true },
		...FPS_OPTIONS.filter((value) => value !== projectFps).map((value) => ({
			value,
			isProject: false,
		})),
	];
	const exportResult = exportState.result;

	const applyBackgroundColor = (value: string) => {
		const normalized = normalizeExportHexColor({ value });
		if (!normalized) return;
		setBackgroundColor(normalized);
		setHexInput(normalized);
	};

	const handleExport = async () => {
		const normalizedColor = normalizeExportHexColor({ value: hexInput });
		if (exportMode === "captions_solid_background" && !normalizedColor) {
			toast.error("Enter a valid six-digit hex background color.");
			return;
		}

		const result = await editor.project.export({
			options: {
				exportMode,
				format: "mp4",
				quality,
				fps: { numerator: fps, denominator: 1 },
				includeAudio,
				...(exportMode === "captions_solid_background" && normalizedColor
					? { backgroundColor: normalizedColor }
					: {}),
				canvasSize: {
					width: selectedResolution.width,
					height: selectedResolution.height,
				},
			},
		});

		if (result.cancelled) {
			editor.project.clearExportState();
			return;
		}

		if (result.success && result.buffer) {
			downloadBuffer({
				buffer: result.buffer,
				filename: `${activeProject.metadata.name}-${exportMode === "full_video" ? "full-video" : "graphics-layer"}${getExportFileExtension({ format: "mp4" })}`,
				mimeType: getExportMimeType({ format: "mp4" }),
			});
			editor.project.clearExportState();
			onOpenChange(false);
		}
	};

	return (
		<DialogContent
			className="flex max-h-[90vh] max-w-[920px] flex-col overflow-hidden p-0"
			style={{ maxHeight: "90vh", maxWidth: "920px" }}
			onEscapeKeyDown={(event) => {
				if (isExporting) event.preventDefault();
			}}
			onInteractOutside={(event) => {
				if (isExporting) event.preventDefault();
			}}
		>
			<DialogHeader className="px-7 py-6">
				<DialogTitle className="text-xl">Export video</DialogTitle>
				<DialogDescription>
					Render the full project or export your graphics and captions over a
					solid background.
				</DialogDescription>
				<p className="text-xs text-muted-foreground">
					Free storage notice: Projects are deleted after 15 minutes of
					inactivity. Download your export before leaving.
				</p>
			</DialogHeader>

			{exportResult && !exportResult.success ? (
				<ExportError
					error={normalizeExportError(exportResult.error)}
					onRetry={handleExport}
				/>
			) : isExporting ? (
				<ExportProgress
					progress={exportState.progress}
					onCancel={() => editor.project.cancelExport()}
				/>
			) : (
				<>
					<DialogBody className="overflow-y-auto px-7 py-6">
						<div className="grid gap-3 md:grid-cols-2">
							<button
								type="button"
								aria-pressed={exportMode === "full_video"}
								onClick={() => setExportMode("full_video")}
								className={cn(
									"group relative flex min-h-32 flex-col items-start rounded-sm border-2 p-4 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
									exportMode === "full_video"
										? "border-primary bg-primary/10 shadow-[4px_4px_0_var(--shadow-strong)]"
										: "border-border bg-background hover:bg-accent/50",
								)}
							>
								<div className="mb-4 flex w-full items-start justify-between gap-3">
									<span className="rounded-sm border bg-background p-2">
										<Film className="size-5 text-muted-foreground" />
									</span>
									<span className="rounded-sm border border-[var(--neo-black)] bg-[var(--neo-yellow)] px-2.5 py-1 text-[11px] font-black text-[var(--neo-black)]">
										Recommended
									</span>
								</div>
								<span className="font-medium">Full Video</span>
								<span className="mt-1 text-xs leading-relaxed text-muted-foreground">
									Render the complete edited video with source media, captions,
									text, effects, motion templates and audio.
								</span>
							</button>

							<button
								type="button"
								aria-pressed={exportMode === "captions_solid_background"}
								onClick={() => setExportMode("captions_solid_background")}
								className={cn(
									"relative flex min-h-32 flex-col items-start rounded-sm border-2 p-4 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
									exportMode === "captions_solid_background"
										? "border-primary bg-primary/10 shadow-[4px_4px_0_var(--shadow-strong)]"
										: "border-border bg-background hover:bg-accent/50",
								)}
							>
								<div className="mb-4 flex w-full items-start justify-between gap-3">
									<span className="rounded-sm border-2 border-border bg-primary p-2 text-primary-foreground">
										<Layers3 className="size-5" />
									</span>
								</div>
								<span className="font-medium">Graphics & Captions Layer</span>
								<span className="mt-1 text-xs leading-relaxed text-muted-foreground">
									Render captions, text, effects and motion templates over a
									solid background without the base video track.
								</span>
							</button>
						</div>

						<div className="grid gap-x-8 gap-y-6 rounded-sm border bg-background/40 p-5 md:grid-cols-2">
							{exportMode === "captions_solid_background" ? (
								<OptionSection
									title="Background"
									description="Choose the chroma or solid canvas color."
								>
									<div className="flex items-center gap-2">
										<label
											className="relative size-9 shrink-0 overflow-hidden rounded-md border"
											style={{ backgroundColor }}
										>
											<span className="sr-only">Background color</span>
											<input
												ref={colorInputRef}
												type="color"
												value={backgroundColor}
												onChange={(event) =>
													applyBackgroundColor(event.target.value)
												}
												className="absolute inset-0 size-full cursor-pointer opacity-0"
											/>
										</label>
										<Input
											value={hexInput}
											onChange={(event) => {
												const value = event.target.value;
												setHexInput(value);
												const normalized = normalizeExportHexColor({ value });
												if (normalized) setBackgroundColor(normalized);
											}}
											onBlur={() => {
												const normalized = normalizeExportHexColor({
													value: hexInput,
												});
												setHexInput(normalized ?? backgroundColor);
											}}
											aria-label="Background hex color"
											className="font-mono uppercase"
										/>
									</div>
									<div
										className="grid gap-2"
										style={{
											gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
										}}
									>
										{BACKGROUND_PRESETS.map((preset) => (
											<ChoiceButton
												key={preset.value}
												selected={backgroundColor === preset.value}
												onClick={() => applyBackgroundColor(preset.value)}
											>
												<span
													className="size-2.5 rounded-full border"
													style={{ backgroundColor: preset.value }}
												/>
												{preset.label}
											</ChoiceButton>
										))}
										<ChoiceButton
											selected={
												!BACKGROUND_PRESETS.some(
													(preset) => preset.value === backgroundColor,
												)
											}
											onClick={() => colorInputRef.current?.click()}
										>
											Custom
										</ChoiceButton>
									</div>
								</OptionSection>
							) : (
								<OptionSection
									title="Background"
									description="Background is determined by your project canvas and source media."
								>
									<p className="text-xs text-muted-foreground">
										Solid background selection is available for Graphics &
										Captions Layer exports.
									</p>
								</OptionSection>
							)}

							<OptionSection
								title="Resolution"
								description="Pick the canvas that matches your edit."
							>
								<div className="grid grid-cols-2 gap-2">
									{resolutionOptions.map((preset) => (
										<ChoiceButton
											key={`${preset.isProject ? "project" : "preset"}:${preset.width}x${preset.height}`}
											selected={
												preset.isProject
													? resolutionOverride === null
													: resolutionOverride?.width === preset.width &&
														resolutionOverride.height === preset.height
											}
											onClick={() =>
												setResolutionOverride(
													preset.isProject
														? null
														: { width: preset.width, height: preset.height },
												)
											}
											className="h-auto items-start justify-start px-3 py-2.5"
										>
											<span className="flex flex-col items-start">
												<span>{preset.label}</span>
												<span className="text-[11px] font-normal text-muted-foreground">
													{preset.detail}
												</span>
											</span>
										</ChoiceButton>
									))}
								</div>
							</OptionSection>

							<OptionSection
								title="Frame rate"
								description="Controls the exported composition frame rate."
							>
								<div className="grid grid-cols-2 gap-2">
									{fpsOptions.map((option) => (
										<ChoiceButton
											key={`${option.isProject ? "project" : "preset"}:${option.value}`}
											selected={
												option.isProject
													? fpsOverride === null
													: fpsOverride === option.value
											}
											onClick={() =>
												setFpsOverride(option.isProject ? null : option.value)
											}
										>
											<span className="flex flex-col">
												<span>
													{option.value} FPS
													{option.isProject ? " · Project" : ""}
												</span>
												{option.value === 60 ? (
													<span className="text-[10px] font-normal text-muted-foreground">
														Smoother motion
													</span>
												) : null}
											</span>
										</ChoiceButton>
									))}
								</div>
							</OptionSection>

							<OptionSection
								title="Quality"
								description="Balance render speed and caption detail."
							>
								<div className="grid grid-cols-3 gap-2">
									{QUALITY_OPTIONS.map((option) => (
										<ChoiceButton
											key={option.value}
											selected={quality === option.value}
											onClick={() => setQuality(option.value)}
											className="h-auto flex-col py-2"
										>
											<span>{option.label}</span>
											<span className="text-[10px] font-normal text-muted-foreground">
												{option.description}
											</span>
										</ChoiceButton>
									))}
								</div>
							</OptionSection>

							<div className="flex items-center justify-between gap-4 border-2 border-border bg-muted/15 p-3 md:col-span-2">
								<div>
									<p className="text-sm font-medium">Include audio</p>
									<p className="mt-0.5 text-xs text-muted-foreground">
										{exportMode === "full_video"
											? "Include enabled project audio in the rendered video."
											: "Include original audio while ordinary source video frames remain excluded."}
									</p>
								</div>
								<Switch
									checked={includeAudio}
									onCheckedChange={setIncludeAudio}
									aria-label="Include audio"
								/>
							</div>
						</div>

						{exportMode === "captions_solid_background" ? (
							<p className="text-xs leading-relaxed text-muted-foreground">
								Use a green background as a graphics layer in Premiere Pro,
								CapCut, DaVinci Resolve, or another editor with chroma key.
							</p>
						) : null}
					</DialogBody>

					<DialogFooter className="px-7">
						<Button variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button onClick={handleExport} className="min-w-52 gap-2">
							<Download className="size-4" />
							{exportMode === "full_video"
								? "Export Full Video"
								: "Export Graphics Layer"}
						</Button>
					</DialogFooter>
				</>
			)}
		</DialogContent>
	);
}

function OptionSection({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: React.ReactNode;
}) {
	return (
		<section className="space-y-3">
			<div>
				<h3 className="text-sm font-medium">{title}</h3>
				<p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
			</div>
			{children}
		</section>
	);
}

function ChoiceButton({
	selected,
	className,
	children,
	onClick,
}: {
	selected: boolean;
	className?: string;
	children: React.ReactNode;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={selected}
			onClick={onClick}
			className={cn(
				"flex h-9 items-center justify-center gap-1.5 border-2 px-2 text-xs font-medium transition-colors",
				selected
					? "border-primary bg-primary/10 text-foreground"
					: "border-border bg-background text-muted-foreground hover:bg-accent/50 hover:text-foreground",
				className,
			)}
		>
			{children}
		</button>
	);
}

function ExportProgress({
	progress,
	onCancel,
}: {
	progress: number;
	onCancel: () => void;
}) {
	return (
		<div className="flex min-h-80 flex-col items-center justify-center px-12 py-14 text-center">
			<div className="mb-5 rounded-full bg-primary/10 p-4">
				<Layers3 className="size-7 text-primary" />
			</div>
			<h3 className="text-lg font-semibold">Exporting animated captions</h3>
			<p className="mt-2 max-w-md text-sm text-muted-foreground">
				Rendering the caption layer and muxing the original audio. Keep this
				window open until the MP4 is ready.
			</p>
			<div className="mt-7 w-full max-w-lg space-y-2">
				<div className="flex justify-between text-xs text-muted-foreground">
					<span>{Math.round(progress * 100)}%</span>
					<span>100%</span>
				</div>
				<Progress value={progress * 100} />
			</div>
			<Button variant="outline" className="mt-7 min-w-32" onClick={onCancel}>
				Cancel export
			</Button>
		</div>
	);
}

function ExportError({
	error,
	onRetry,
}: {
	error: string;
	onRetry: () => void;
}) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(sanitizeClipboardText(error));
		setCopied(true);
		setTimeout(() => setCopied(false), 1000);
	};

	return (
		<div className="flex min-h-72 flex-col justify-center space-y-5 p-8">
			<div>
				<p className="text-destructive text-base font-medium">Export failed</p>
				<p className="mt-2 text-sm text-muted-foreground">{error}</p>
			</div>
			<div className="flex gap-2">
				<Button variant="outline" onClick={handleCopy}>
					{copied ? <Check className="text-constructive" /> : <Copy />}
					Copy error
				</Button>
				<Button onClick={onRetry}>
					<RotateCcw />
					Retry
				</Button>
			</div>
		</div>
	);
}
