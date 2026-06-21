"use client";

import { useRef, useState } from "react";
import { TransitionTopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	Check,
	Copy,
	Download,
	Film,
	Layers3,
	RotateCcw,
	Sparkles,
} from "lucide-react";
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
import {
	downloadBuffer,
	getExportFileExtension,
	getExportMimeType,
	normalizeExportError,
	type ExportQuality,
} from "@/export";
import { useEditor } from "@/editor/use-editor";
import { DEFAULT_EXPORT_OPTIONS } from "@/export/defaults";

const FULL_VIDEO_COMING_SOON =
	"Full video export is coming soon. For now, use Animated Captions with Solid Background. It exports faster and works as a green-screen caption layer in editing apps.";

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

const FPS_OPTIONS = [24, 30] as const;
const QUALITY_OPTIONS: Array<{
	value: Extract<ExportQuality, "fast" | "balanced" | "high">;
	label: string;
	description: string;
}> = [
	{ value: "fast", label: "Fast", description: "Quickest render" },
	{ value: "balanced", label: "Balanced", description: "Recommended" },
	{ value: "high", label: "High", description: "Best detail" },
];

function normalizeHexColor(value: string): string | null {
	const trimmed = value.trim();
	const normalized = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
	return /^#[0-9A-Fa-f]{6}$/.test(normalized) ? normalized.toUpperCase() : null;
}

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
				className={cn(
					"flex h-9 items-center gap-2 rounded-lg border-2 border-[var(--cap-outline)] bg-[var(--cap-lime)] px-4 text-sm font-black text-[#111] shadow-[3px_3px_0_var(--cap-shadow-color)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[4px_4px_0_var(--cap-shadow-color)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--cap-shadow-color)]",
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
	const [resolutionIndex, setResolutionIndex] = useState(0);
	const [fps, setFps] = useState<(typeof FPS_OPTIONS)[number]>(30);
	const [quality, setQuality] =
		useState<Extract<ExportQuality, "fast" | "balanced" | "high">>("balanced");
	const [includeAudio, setIncludeAudio] = useState(true);
	const colorInputRef = useRef<HTMLInputElement>(null);

	if (!isOpen) {
		return null;
	}

	const selectedResolution = RESOLUTION_PRESETS[resolutionIndex];
	const exportResult = exportState.result;

	const applyBackgroundColor = (value: string) => {
		const normalized = normalizeHexColor(value);
		if (!normalized) return;
		setBackgroundColor(normalized);
		setHexInput(normalized);
	};

	const handleExport = async () => {
		const normalizedColor = normalizeHexColor(hexInput);
		if (!normalizedColor) {
			toast.error("Enter a valid six-digit hex background color.");
			return;
		}

		const result = await editor.project.export({
			options: {
				exportMode: "captions_solid_background",
				format: "mp4",
				quality,
				fps: { numerator: fps, denominator: 1 },
				includeAudio,
				backgroundColor: normalizedColor,
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
				filename: `${activeProject.metadata.name}-animated-captions${getExportFileExtension({ format: "mp4" })}`,
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
				<DialogTitle className="text-xl">Export</DialogTitle>
				<DialogDescription>
					Create an animated caption layer ready for your editing workflow.
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
								aria-disabled="true"
								onClick={() => toast.info(FULL_VIDEO_COMING_SOON)}
								className="group relative flex min-h-32 cursor-not-allowed flex-col items-start rounded-xl border border-border/70 bg-muted/20 p-4 text-left opacity-65 outline-none transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-muted-foreground/30"
							>
								<div className="mb-4 flex w-full items-start justify-between gap-3">
									<span className="rounded-lg border bg-background p-2">
										<Film className="size-5 text-muted-foreground" />
									</span>
									<span className="rounded-full border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
										Coming soon
									</span>
								</div>
								<span className="font-medium">Full Video Export</span>
								<span className="mt-1 text-xs leading-relaxed text-muted-foreground">
									Render the original video with captions burned in.
								</span>
							</button>

							<div className="relative flex min-h-32 flex-col items-start rounded-xl border border-primary/60 bg-primary/5 p-4 text-left shadow-[0_0_0_1px_hsl(var(--primary)/0.08)]">
								<div className="mb-4 flex w-full items-start justify-between gap-3">
									<span className="rounded-lg bg-primary/15 p-2">
										<Layers3 className="size-5 text-primary" />
									</span>
									<span className="flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground">
										<Sparkles className="size-3" />
										Recommended
									</span>
								</div>
								<span className="font-medium">
									Animated Captions with Solid Background
								</span>
								<span className="mt-1 text-xs leading-relaxed text-muted-foreground">
									Fast caption-layer MP4 with no original video frames.
								</span>
							</div>
						</div>

						<div className="grid gap-x-8 gap-y-6 rounded-xl border bg-background/40 p-5 md:grid-cols-2">
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
											const normalized = normalizeHexColor(value);
											if (normalized) setBackgroundColor(normalized);
										}}
										onBlur={() => {
											const normalized = normalizeHexColor(hexInput);
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

							<OptionSection
								title="Resolution"
								description="Pick the canvas that matches your edit."
							>
								<div className="grid grid-cols-2 gap-2">
									{RESOLUTION_PRESETS.map((preset, index) => (
										<ChoiceButton
											key={`${preset.width}x${preset.height}`}
											selected={resolutionIndex === index}
											onClick={() => setResolutionIndex(index)}
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
								title="FPS"
								description="Caption animation frame rate."
							>
								<div className="grid grid-cols-2 gap-2">
									{FPS_OPTIONS.map((value) => (
										<ChoiceButton
											key={value}
											selected={fps === value}
											onClick={() => setFps(value)}
										>
											{value} FPS
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

							<div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/15 p-3 md:col-span-2">
								<div>
									<p className="text-sm font-medium">Include original audio</p>
									<p className="mt-0.5 text-xs text-muted-foreground">
										Uses only the source audio; original video frames are
										skipped.
									</p>
								</div>
								<Switch
									checked={includeAudio}
									onCheckedChange={setIncludeAudio}
									aria-label="Include original audio"
								/>
							</div>
						</div>

						<p className="text-xs leading-relaxed text-muted-foreground">
							Use green background export as a caption layer in Premiere Pro,
							CapCut, DaVinci Resolve, or any editor with chroma key.
						</p>
					</DialogBody>

					<DialogFooter className="px-7">
						<Button variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button onClick={handleExport} className="min-w-52 gap-2">
							<Download className="size-4" />
							Export Animated Captions
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
				"flex h-9 items-center justify-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors",
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
		await navigator.clipboard.writeText(error);
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
