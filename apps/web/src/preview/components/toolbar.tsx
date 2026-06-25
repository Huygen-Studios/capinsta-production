"use client";

import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
} from "react";
import { useEditor } from "@/editor/use-editor";
import { formatTimecode } from "opencut-wasm";
import { invokeAction } from "@/actions";
import { EditableTimecode } from "@/components/editable-timecode";
import { Button } from "@/components/ui/button";
import {
	FullScreenIcon,
	PauseIcon,
	PlayIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Maximize2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import {
	Select,
	SelectTrigger,
	SelectContent,
	SelectItem,
	SelectSeparator,
} from "@/components/ui/select";
import { PREVIEW_ZOOM_PRESETS } from "@/preview/zoom";
import { usePreviewViewport } from "./preview-viewport";
import {
	usePreviewStore,
	PREVIEW_QUALITY_LABELS,
	isPreviewQuality,
} from "@/preview/preview-store";
import type { MediaTime } from "@/wasm";

export function PreviewToolbar({
	onToggleFullscreen,
}: {
	onToggleFullscreen: () => void;
}) {
	return (
		<div className="grid gap-2 border-t border-border bg-card px-4 pb-2.5 pt-2">
			<PreviewScrubBar />
			<div className="grid grid-cols-[1fr_auto_1fr] items-center">
				<TimecodeDisplay />
				<PlayPauseButton />
				<div className="justify-self-end flex items-center gap-2">
					<PreviewQualitySelect />
					<PreviewZoomControls />
					<ZoomSelect />
					<Separator orientation="vertical" className="h-4" />
					{/* v0.4.0 */}
					{/* <GridPopover>
						<Button
							variant={activeGuideDefinition ? "secondary" : "text"}
							size="icon"
						>
							{activeGuideDefinition ? (
								activeGuideDefinition.renderTriggerIcon()
							) : (
								<HugeiconsIcon icon={GridTableIcon} />
							)}
						</Button>
					</GridPopover> */}
					<Button variant="text" onClick={onToggleFullscreen}>
						<HugeiconsIcon icon={FullScreenIcon} />
					</Button>
				</div>
			</div>
		</div>
	);
}

function usePreviewClock() {
	const editor = useEditor();
	const totalDuration = useEditor((e) => e.timeline.getTotalDuration());
	const fps = useEditor((e) => e.project.getActive().settings.fps);
	const [currentTime, setCurrentTime] = useState<MediaTime>(() =>
		editor.playback.getCurrentTime(),
	);
	const pendingTimeRef = useRef(currentTime);
	const updateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lastUpdateAtRef = useRef(0);

	useEffect(() => {
		const commitPendingTime = () => {
			updateTimerRef.current = null;
			lastUpdateAtRef.current = performance.now();
			setCurrentTime(pendingTimeRef.current);
		};
		const onUpdate = (time: MediaTime) => {
			pendingTimeRef.current = time;
			if (updateTimerRef.current) return;
			const elapsed = performance.now() - lastUpdateAtRef.current;
			updateTimerRef.current = setTimeout(
				commitPendingTime,
				Math.max(0, 100 - elapsed),
			);
		};
		const onSeek = (time: MediaTime) => {
			pendingTimeRef.current = time;
			if (updateTimerRef.current) {
				clearTimeout(updateTimerRef.current);
				updateTimerRef.current = null;
			}
			commitPendingTime();
		};
		const unsubscribeUpdate = editor.playback.onUpdate(onUpdate);
		const unsubscribeSeek = editor.playback.onSeek(onSeek);
		return () => {
			if (updateTimerRef.current) {
				clearTimeout(updateTimerRef.current);
			}
			unsubscribeUpdate();
			unsubscribeSeek();
		};
	}, [editor.playback]);

	return { currentTime, editor, fps, totalDuration };
}

function PreviewScrubBar() {
	const { currentTime, editor, totalDuration } = usePreviewClock();
	const trackRef = useRef<HTMLDivElement>(null);
	const progress =
		totalDuration > 0
			? Math.min(1, Math.max(0, currentTime / totalDuration))
			: 0;

	const seekFromClientX = useCallback(
		(clientX: number) => {
			const rect = trackRef.current?.getBoundingClientRect();
			if (!rect || rect.width <= 0 || totalDuration <= 0) return;
			const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
			editor.playback.seek({ time: Math.round(totalDuration * ratio) as MediaTime });
		},
		[editor.playback, totalDuration],
	);

	const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		seekFromClientX(event.clientX);
	};

	const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
		seekFromClientX(event.clientX);
	};

	const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (totalDuration <= 0) return;
		const step = totalDuration / 100;
		if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
			event.preventDefault();
			editor.playback.seek({
				time: Math.max(0, Math.round(currentTime - step)) as MediaTime,
			});
		}
		if (event.key === "ArrowRight" || event.key === "ArrowUp") {
			event.preventDefault();
			editor.playback.seek({
				time: Math.min(totalDuration, Math.round(currentTime + step)) as MediaTime,
			});
		}
		if (event.key === "Home") {
			event.preventDefault();
			editor.playback.seek({ time: 0 as MediaTime });
		}
		if (event.key === "End") {
			event.preventDefault();
			editor.playback.seek({ time: totalDuration });
		}
	};

	return (
		<div
			ref={trackRef}
			role="slider"
			tabIndex={0}
			aria-label="Preview position"
			aria-valuemin={0}
			aria-valuemax={Math.max(0, totalDuration)}
			aria-valuenow={Math.min(currentTime, totalDuration)}
			className="group relative h-3 cursor-pointer rounded-sm outline-none"
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onKeyDown={handleKeyDown}
		>
			<div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-sm border border-border bg-muted" />
			<div
				className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-sm border border-[var(--neo-black)] bg-primary"
				style={{ width: `${progress * 100}%` }}
			/>
			<div
				className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--neo-black)] bg-background shadow-[1px_1px_0_var(--shadow-strong)] transition-transform group-hover:scale-110 group-focus-visible:scale-110"
				style={{ left: `${progress * 100}%` }}
			/>
		</div>
	);
}

function PreviewZoomControls() {
	const {
		fitToScreen,
		isAtFit,
		isAtActualSize,
		setViewportPercent,
		zoomIn,
		zoomOut,
	} = usePreviewViewport();

	return (
		<div className="flex items-center gap-1">
			<Button
				variant="text"
				size="icon"
				aria-label="Zoom out"
				onClick={zoomOut}
			>
				<ZoomOut className="size-4" />
			</Button>
			<Button
				variant={isAtActualSize ? "secondary" : "text"}
				size="icon"
				aria-label="Reset preview zoom to 100%"
				onClick={() => setViewportPercent({ percent: 100 })}
			>
				<RotateCcw className="size-4" />
			</Button>
			<Button
				variant={isAtFit ? "secondary" : "text"}
				size="icon"
				aria-label="Fit preview to panel"
				onClick={fitToScreen}
			>
				<Maximize2 className="size-4" />
			</Button>
			<Button variant="text" size="icon" aria-label="Zoom in" onClick={zoomIn}>
				<ZoomIn className="size-4" />
			</Button>
		</div>
	);
}

function TimecodeDisplay() {
	const { currentTime, editor, fps, totalDuration } = usePreviewClock();

	return (
		<div className="flex items-center">
			<EditableTimecode
				time={currentTime}
				duration={totalDuration}
				format="HH:MM:SS:FF"
				fps={fps}
				onTimeChange={({ time }) => editor.playback.seek({ time })}
				className="rounded-sm border border-[var(--neo-black)] bg-primary px-1.5 py-0.5 text-center font-mono text-xs font-bold text-primary-foreground shadow-none hover:bg-primary/90 focus-visible:bg-primary"
			/>
			<span className="px-2 font-mono text-xs text-foreground/70">/</span>
			<span className="font-mono text-xs font-medium text-foreground/75">
				{formatTimecode({
					time: totalDuration,
					format: "HH:MM:SS:FF",
					rate: fps,
				})}
			</span>
		</div>
	);
}

function ZoomSelect() {
	const { isAtFit, zoomPercent, fitToScreen, setViewportPercent } =
		usePreviewViewport();

	const displayLabel = isAtFit ? "Fit" : `${zoomPercent}%`;

	const onValueChange = (value: string) => {
		if (value === "fit") {
			fitToScreen();
		} else {
			setViewportPercent({ percent: Number(value) });
		}
	};

	return (
		<Select
			value={isAtFit ? "fit" : String(zoomPercent)}
			onValueChange={onValueChange}
		>
			<SelectTrigger className="tabular-nums">{displayLabel}</SelectTrigger>
			<SelectContent>
				<SelectItem value="fit">Fit</SelectItem>
				<SelectSeparator />
				{PREVIEW_ZOOM_PRESETS.map((preset) => (
					<SelectItem key={preset} value={String(preset)}>
						{preset}%
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function PreviewQualitySelect() {
	const previewQuality = usePreviewStore((state) => state.previewQuality);
	const resolvedQuality = usePreviewStore((state) => state.resolvedQuality);
	const setPreviewQuality = usePreviewStore((state) => state.setPreviewQuality);

	// In auto mode, show the resolved quality level in parentheses
	const displayLabel =
		previewQuality === "auto"
			? `Auto (${PREVIEW_QUALITY_LABELS[resolvedQuality]})`
			: PREVIEW_QUALITY_LABELS[previewQuality];

	const onValueChange = (value: string) => {
		if (isPreviewQuality(value)) {
			setPreviewQuality(value);
		}
	};

	return (
		<div className="flex items-center gap-1.5">
			<span className="text-muted-foreground text-xs">Preview</span>
			<Select value={previewQuality} onValueChange={onValueChange}>
				<SelectTrigger
					className="h-7 w-[92px] tabular-nums text-xs"
					aria-label="Preview resolution"
				>
					{displayLabel}
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="full">Full</SelectItem>
					<SelectItem value="half">1/2</SelectItem>
					<SelectItem value="quarter">1/4</SelectItem>
					<SelectSeparator />
					<SelectItem value="auto">Auto</SelectItem>
				</SelectContent>
			</Select>
		</div>
	);
}

function PlayPauseButton() {
	const isPlaying = useEditor((e) => e.playback.getIsPlaying());

	return (
		<Button
			variant="text"
			size="icon"
			onClick={() => invokeAction("toggle-play")}
		>
			<HugeiconsIcon icon={isPlaying ? PauseIcon : PlayIcon} />
		</Button>
	);
}
