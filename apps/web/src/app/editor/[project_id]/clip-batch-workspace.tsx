/* eslint-disable opencut/prefer-object-params -- Pointer callbacks follow the DOM event API. */
"use client";

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useEditor } from "@/editor/use-editor";
import type {
	LocalClipBatchV1,
	LocalClipItemV1,
	LocalClipPlatformPresetV1,
	TProject,
} from "@/project/types";
import {
	activateClip,
	activateNormalEditor,
	countElementsOutsideRange,
	createLocalClipBatch,
	duplicateLocalClip,
	orderedClipItems,
	removeLocalClip,
	reorderLocalClip,
	retimeLocalClip,
	updateLocalClip,
} from "@/services/clip-batches/local";
import {
	generateLocalClipCaptions,
	removeGeneratedCaptions,
	type LocalCaptionProgress,
} from "@/services/clip-batches/local-captions";
import {
	createLocalClipZip,
	downloadBlob,
} from "@/services/clip-batches/local-export";
import {
	adjustClipRange,
	initialClipRanges,
	sanitizeClipFilename,
	type ClipRangeAdjustment,
} from "@/services/clip-batches/ranges";
import { downloadBuffer } from "@/export";
import { ZERO_MEDIA_TIME } from "@/wasm";

type BatchContextValue = {
	isClippingMode: boolean;
	batch: LocalClipBatchV1 | null;
	createBatch: (options: CreateBatchOptions) => Promise<void>;
	mutateBatch: (
		change: (batch: LocalClipBatchV1) => LocalClipBatchV1,
		activateId?: string,
	) => Promise<void>;
	switchClip: (clipId: string) => Promise<void>;
	setRange: (
		item: LocalClipItemV1,
		start: number,
		end: number,
	) => Promise<void>;
};

type CreateBatchOptions = {
	count: number;
	maximumClipDurationMs: number;
	platformPreset: LocalClipPlatformPresetV1;
	captionsEnabled: boolean;
	headingsEnabled: boolean;
};

const BatchContext = createContext<BatchContextValue | null>(null);

export function ClipBatchProvider({ children }: { children: ReactNode }) {
	const editor = useEditor();
	const searchParams = useSearchParams();
	const isClippingMode = searchParams.get("mode") === "clipping";
	const batch = useEditor(
		(instance) =>
			instance.project.getActiveOrNull()?.capinstaLocalClipBatch ?? null,
	);
	const reconciledMode = useRef<boolean | null>(null);

	const applyProject = useCallback(
		async (project: TProject, scope: string) => {
			editor.playback.pause();
			editor.project.setActiveProject({ project });
			editor.scenes.initializeScenes({
				scenes: project.scenes,
				currentSceneId: project.currentSceneId,
			});
			editor.command.switchScope({ scope });
			editor.playback.seek({
				time: project.timelineViewState?.playheadTime ?? ZERO_MEDIA_TIME,
			});
			await editor.project.saveCurrentProject();
		},
		[editor],
	);

	useEffect(() => {
		if (reconciledMode.current === isClippingMode) return;
		reconciledMode.current = isClippingMode;
		void (async () => {
			await editor.project.saveCurrentProject();
			const project = editor.project.getActive();
			const currentBatch = project.capinstaLocalClipBatch;
			if (isClippingMode) {
				if (currentBatch?.selectedClipId)
					await applyProject(
						activateClip(project, currentBatch, currentBatch.selectedClipId),
						currentBatch.selectedClipId,
					);
				else {
					editor.project.setActiveProject({
						project: { ...project, capinstaEditorMode: "clipping" },
					});
					await editor.project.saveCurrentProject();
				}
			} else if (currentBatch) {
				await applyProject(
					activateNormalEditor(project, currentBatch),
					"normal",
				);
			} else {
				editor.command.switchScope({ scope: "normal" });
			}
		})();
	}, [applyProject, editor, isClippingMode]);

	const mutateBatch = useCallback(
		async (
			change: (batch: LocalClipBatchV1) => LocalClipBatchV1,
			activateId?: string,
		) => {
			await editor.project.saveCurrentProject();
			const project = editor.project.getActive();
			const current = project.capinstaLocalClipBatch;
			if (!current) return;
			const next = change(current);
			if (activateId)
				await applyProject(activateClip(project, next, activateId), activateId);
			else {
				editor.project.setActiveProject({
					project: { ...project, capinstaLocalClipBatch: next },
				});
				await editor.project.saveCurrentProject();
			}
		},
		[applyProject, editor],
	);

	const createBatch = useCallback(
		async (options: CreateBatchOptions) => {
			await editor.project.saveCurrentProject();
			const project = editor.project.getActive();
			const source = editor.media
				.getAssets()
				.find((asset) => asset.type === "video");
			if (!source)
				throw new Error(
					"Import a local video with the existing Assets picker first.",
				);
			const { count, ...batchOptions } = options;
			const ranges = initialClipRanges({
				sourceDurationMs: Math.round((source.duration ?? 0) * 1000),
				count,
				maximumDurationMs: options.maximumClipDurationMs,
			});
			const next = createLocalClipBatch({
				project,
				source,
				ranges,
				...batchOptions,
			});
			if (!next.selectedClipId)
				throw new Error("No clip ranges could be created.");
			await applyProject(
				activateClip(project, next, next.selectedClipId),
				next.selectedClipId,
			);
		},
		[applyProject, editor],
	);

	const switchClip = useCallback(
		async (clipId: string) => mutateBatch((value) => value, clipId),
		[mutateBatch],
	);

	const setRange = useCallback(
		async (item: LocalClipItemV1, start: number, end: number) => {
			await editor.project.saveCurrentProject();
			const current = editor.project.getActive().capinstaLocalClipBatch;
			if (
				!current ||
				start < 0 ||
				end <= start ||
				end > current.sourceDurationMs ||
				end - start > current.maximumClipDurationMs
			) {
				throw new Error(
					"The selected clip must be shorter than three minutes and remain inside the source video.",
				);
			}
			const persistedItem = current.items.find(
				(candidate) => candidate.id === item.id,
			);
			if (!persistedItem) throw new Error("Clip could not be found.");
			const affected = countElementsOutsideRange(persistedItem, start, end);
			if (
				affected &&
				!window.confirm(
					`${affected} timed element${affected === 1 ? "" : "s"} extend beyond the new range. Clamp them to the new duration?`,
				)
			)
				return;
			const nextItem = retimeLocalClip(
				{ ...persistedItem, title: item.title },
				start,
				end,
				current.sourceDurationMs,
			);
			await mutateBatch(
				(value) => updateLocalClip(value, item.id, nextItem),
				current.selectedClipId === item.id ? item.id : undefined,
			);
		},
		[editor, mutateBatch],
	);

	const value = useMemo<BatchContextValue>(
		() => ({
			isClippingMode,
			batch,
			createBatch,
			mutateBatch,
			switchClip,
			setRange,
		}),
		[batch, createBatch, isClippingMode, mutateBatch, setRange, switchClip],
	);
	return (
		<BatchContext.Provider value={value}>{children}</BatchContext.Provider>
	);
}

export function ClipBatchDock() {
	const value = useContext(BatchContext);
	if (!value?.isClippingMode) return null;
	return <ClipBatchDockContent />;
}

function ClipBatchDockContent() {
	const editor = useEditor();
	const context = useBatch();
	const { batch, createBatch, mutateBatch, switchClip } = context;
	const [modal, setModal] = useState(false);
	const [count, setCount] = useState(5);
	const [maximumDurationSeconds, setMaximumDurationSeconds] = useState(60);
	const [platformPreset, setPlatformPreset] =
		useState<LocalClipPlatformPresetV1>("instagram_reels");
	const [captionsEnabled, setCaptionsEnabled] = useState(false);
	const [headingsEnabled, setHeadingsEnabled] = useState(false);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	const cancelCaptions = useRef(false);

	async function run(action: () => Promise<void>) {
		if (busy) return;
		setBusy(true);
		setMessage("");
		try {
			await action();
		} catch (error) {
			setMessage(
				error instanceof Error
					? error.message
					: "The local operation could not be completed.",
			);
		} finally {
			setBusy(false);
		}
	}

	async function makeBatch() {
		await run(async () => {
			await createBatch({
				count,
				maximumClipDurationMs: maximumDurationSeconds * 1000,
				platformPreset,
				captionsEnabled,
				headingsEnabled,
			});
			setModal(false);
			setMessage(`${count} local clip ranges created.`);
		});
	}

	async function generateOne(item: LocalClipItemV1, index = 0, total = 1) {
		await switchClip(item.id);
		const latest =
			editor.project
				.getActive()
				.capinstaLocalClipBatch?.items.find(
					(candidate) => candidate.id === item.id,
				) ?? item;
		if (latest.captionStatus === "completed") {
			if (
				!window.confirm(
					`${latest.title} already has generated captions. Replace them?`,
				)
			)
				return;
			removeGeneratedCaptions(editor);
		}
		const source = editor.media
			.getAssets()
			.find((asset) => asset.id === batch?.sourceMediaId);
		if (!source)
			throw new Error(
				"Reconnect the original source video to continue editing.",
			);
		const labels: Record<LocalCaptionProgress, string> = {
			preparing: "Preparing selected audio",
			uploading: "Uploading selected clip",
			transcribing: "Transcribing",
			creating: "Creating editable captions",
			completed: "Completed",
		};
		await mutateBatch((value) =>
			updateLocalClip(value, item.id, { captionStatus: "preparing" }),
		);
		try {
			await generateLocalClipCaptions({
				editor,
				source,
				item: latest,
				onProgress: (progress) =>
					setMessage(
						`Generating captions — Clip ${index + 1} of ${total}\n${labels[progress]}`,
					),
			});
			await editor.project.saveCurrentProject();
			await mutateBatch((value) =>
				updateLocalClip(value, item.id, { captionStatus: "completed" }),
			);
		} catch (error) {
			await mutateBatch((value) =>
				updateLocalClip(value, item.id, { captionStatus: "failed" }),
			);
			throw error;
		}
	}

	async function generateSelectedCaptions() {
		if (!batch) return;
		cancelCaptions.current = false;
		const selected = orderedClipItems(batch).filter(
			(item) => item.selectedForExport && item.captionsEnabled,
		);
		await run(async () => {
			for (const [index, item] of selected.entries()) {
				if (cancelCaptions.current) break;
				try {
					await generateOne(item, index, selected.length);
				} catch (error) {
					setMessage(
						error instanceof Error
							? error.message
							: `Captions could not be generated for ${item.title}.`,
					);
					if (
						!window.confirm(
							"Skip this clip and continue with the remaining clips?",
						)
					)
						break;
				}
			}
		});
	}

	async function renderCurrent(): Promise<ArrayBuffer> {
		const result = await editor.project.export({
			options: {
				exportMode: "full_video",
				format: "mp4",
				quality: "balanced",
				includeAudio: true,
				localCaptionCarriers: true,
			},
		});
		if (!result.success || !result.buffer)
			throw new Error(result.error || "The clip could not be rendered.");
		return result.buffer;
	}

	async function exportCurrent() {
		if (!batch?.selectedClipId) return;
		const item = batch.items.find(
			(candidate) => candidate.id === batch.selectedClipId,
		);
		if (!item) return;
		await run(async () => {
			assertValidClip({ batch, item });
			const buffer = await renderCurrent();
			downloadBuffer({
				buffer,
				filename: `${sanitizeClipFilename(item.title)}.mp4`,
				mimeType: "video/mp4",
			});
			setMessage(`${item.title} exported.`);
		});
	}

	async function exportMany(items: LocalClipItemV1[]) {
		if (!batch || !items.length) return;
		await run(async () => {
			for (const item of items) assertValidClip({ batch, item });
			if (
				items.reduce(
					(sum, item) => sum + item.sourceEndMs - item.sourceStartMs,
					0,
				) >
					10 * 60_000 &&
				!window.confirm(
					"This batch may use substantial browser memory. Continue?",
				)
			)
				return;
			await mutateBatch((value) => ({
				...value,
				items: value.items.map((item) =>
					items.some((candidate) => candidate.id === item.id)
						? { ...item, exportStatus: "waiting" }
						: item,
				),
			}));
			const failures: string[] = [];
			const zip = await createLocalClipZip({
				batch,
				items,
				render: async (item, index) => {
					await switchClip(item.id);
					await mutateBatch((value) =>
						updateLocalClip(value, item.id, { exportStatus: "rendering" }),
					);
					setMessage(
						`${item.title} — Rendering (${index + 1}/${items.length})`,
					);
					try {
						const buffer = await renderCurrent();
						await mutateBatch((value) =>
							updateLocalClip(value, item.id, { exportStatus: "complete" }),
						);
						return buffer;
					} catch (error) {
						await mutateBatch((value) =>
							updateLocalClip(value, item.id, { exportStatus: "failed" }),
						);
						throw error;
					}
				},
				onError: (item) => failures.push(item.title),
				onProgress: (item, _index, status) =>
					setMessage(
						`${item.title} — ${status === "rendering" ? "Rendering" : "Complete"}`,
					),
			});
			downloadBlob({ blob: zip, filename: "capinsta-clips.zip" });
			setMessage(
				failures.length
					? `ZIP downloaded. Retry failed clips: ${failures.join(", ")}.`
					: "ZIP export complete.",
			);
		});
	}

	if (!batch) {
		return (
			<section
				className="border-b p-3"
				aria-label="Clipping Mode"
				data-testid="clip-batch-dock"
			>
				<strong className="text-sm">Clipping Mode</strong>
				<p className="mt-1 text-xs text-muted-foreground">
					Import one local video in Assets, then create independent clip ranges.
				</p>
				<Button
					className="mt-3 w-full"
					size="sm"
					onClick={() => setModal(true)}
				>
					Create clips
				</Button>
				<CreateDialog
					{...{
						modal,
						setModal,
						count,
						setCount,
						maximumDurationSeconds,
						setMaximumDurationSeconds,
						platformPreset,
						setPlatformPreset,
						captionsEnabled,
						setCaptionsEnabled,
						headingsEnabled,
						setHeadingsEnabled,
						busy,
						makeBatch,
					}}
				/>
				{message ? (
					<p className="mt-2 text-xs text-destructive" role="alert">
						{message}
					</p>
				) : null}
			</section>
		);
	}

	const items = orderedClipItems(batch);
	return (
		<section
			className="border-b p-3"
			aria-label="Clipping Mode"
			data-testid="clip-batch-dock"
		>
			<div className="mb-2 flex items-center justify-between">
				<strong className="text-sm">Clips</strong>
				<span className="text-xs text-muted-foreground">Local only</span>
			</div>
			<div className="max-h-64 space-y-2 overflow-auto">
				{items.map((item) => (
					<ClipItemRow
						key={item.id}
						item={item}
						selected={batch.selectedClipId === item.id}
						onOpen={() => void run(() => switchClip(item.id))}
						onCaption={() => void run(() => generateOne(item))}
						onChange={(patch) =>
							void run(() =>
								mutateBatch((value) => updateLocalClip(value, item.id, patch)),
							)
						}
						onMove={(delta) =>
							void run(() =>
								mutateBatch((value) => reorderLocalClip(value, item.id, delta)),
							)
						}
						onDuplicate={() =>
							void run(() =>
								mutateBatch((value) => duplicateLocalClip(value, item.id)),
							)
						}
						onRemove={() =>
							void run(() =>
								mutateBatch(
									(value) => removeLocalClip(value, item.id),
									batch.selectedClipId === item.id
										? batch.clipOrder.find((id) => id !== item.id)
										: undefined,
								),
							)
						}
					/>
				))}
			</div>
			<div className="mt-3 grid grid-cols-2 gap-2">
				<Button size="sm" disabled={busy} onClick={() => void exportCurrent()}>
					Export current
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={busy}
					onClick={() =>
						void exportMany(items.filter((item) => item.selectedForExport))
					}
				>
					Export selected
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={busy}
					onClick={() => void exportMany(items)}
				>
					Export all
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={busy}
					onClick={() => void generateSelectedCaptions()}
				>
					Generate captions
				</Button>
			</div>
			{busy ? (
				<Button
					className="mt-2 w-full"
					variant="outline"
					size="sm"
					onClick={() => {
						cancelCaptions.current = true;
						editor.project.cancelExport();
					}}
				>
					Cancel remaining
				</Button>
			) : null}
			{message ? (
				<p
					className="mt-2 whitespace-pre-line text-xs text-muted-foreground"
					role="status"
				>
					{message}
				</p>
			) : null}
		</section>
	);
}

function ClipItemRow({
	item,
	selected,
	onOpen,
	onCaption,
	onChange,
	onMove,
	onDuplicate,
	onRemove,
}: {
	item: LocalClipItemV1;
	selected: boolean;
	onOpen: () => void;
	onCaption: () => void;
	onChange: (patch: Partial<LocalClipItemV1>) => void;
	onMove: (delta: number) => void;
	onDuplicate: () => void;
	onRemove: () => void;
}) {
	const { batch, setRange } = useBatch();
	const [title, setTitle] = useState(item.title);
	const [start, setStart] = useState(item.sourceStartMs);
	const [end, setEnd] = useState(item.sourceEndMs);
	const invalid =
		!batch ||
		start < 0 ||
		end <= start ||
		end > batch.sourceDurationMs ||
		end - start > batch.maximumClipDurationMs;
	return (
		<div
			className={`rounded border p-2 text-xs ${selected ? "border-primary bg-primary/5" : ""}`}
			data-testid="clip-batch-item"
			data-clip-item-id={item.id}
		>
			<div className="flex items-center gap-1">
				<Checkbox
					checked={item.selectedForExport}
					onCheckedChange={(value) =>
						onChange({ selectedForExport: value === true })
					}
				/>
				<Button variant="ghost" size="sm" onClick={onOpen}>
					{item.ordinal}
				</Button>
				<Input
					aria-label={`Title for clip ${item.ordinal}`}
					className="h-7 min-w-0"
					value={title}
					onChange={(event) => setTitle(event.target.value)}
				/>
				<Button
					variant="ghost"
					size="sm"
					aria-label="Move clip up"
					onClick={() => onMove(-1)}
				>
					↑
				</Button>
				<Button
					variant="ghost"
					size="sm"
					aria-label="Move clip down"
					onClick={() => onMove(1)}
				>
					↓
				</Button>
			</div>
			<div className="mt-1 grid grid-cols-2 gap-1">
				<Input
					aria-label={`Start time for clip ${item.ordinal}`}
					type="number"
					min={0}
					value={start}
					onChange={(event) => setStart(Number(event.target.value))}
				/>
				<Input
					aria-label={`End time for clip ${item.ordinal}`}
					type="number"
					min={1}
					value={end}
					onChange={(event) => setEnd(Number(event.target.value))}
				/>
			</div>
			<div className="mt-1 flex items-center justify-between">
				<span
					className={invalid ? "text-destructive" : "text-muted-foreground"}
				>
					{formatMs(end - start)}
					{invalid ? " · invalid" : ""} · {item.captionStatus}
					<span className="ml-1">Â· export {item.exportStatus}</span>
				</span>
				<div>
					<Button
						variant="ghost"
						size="sm"
						disabled={invalid || !title.trim()}
						onClick={() =>
							void setRange({ ...item, title: title.trim() }, start, end)
						}
					>
						Save
					</Button>
					<Button
						variant="ghost"
						size="sm"
						disabled={!item.captionsEnabled}
						onClick={onCaption}
					>
						Captions
					</Button>
					<Button variant="ghost" size="sm" onClick={onDuplicate}>
						Duplicate
					</Button>
					<Button variant="ghost" size="sm" onClick={onRemove}>
						Delete
					</Button>
				</div>
			</div>
		</div>
	);
}

export function ClipRangeLane() {
	const value = useContext(BatchContext);
	if (!value?.isClippingMode || !value.batch?.items.length) return null;
	return <ClipRangeLaneContent />;
}

function ClipRangeLaneContent() {
	const { batch, setRange, switchClip } = useBatch();
	if (!batch) return null;
	return (
		<div
			className="h-14 border-y bg-muted/30 px-2 py-1"
			aria-label="Clip ranges"
		>
			<div
				className="relative h-full"
				data-clip-range-lane
				data-testid="clip-range-lane"
			>
				{orderedClipItems(batch).map((item) => (
					<RangeOverlay
						key={`${item.id}:${item.updatedAt}`}
						item={item}
						duration={batch.sourceDurationMs}
						maximumDuration={batch.maximumClipDurationMs}
						selected={item.id === batch.selectedClipId}
						save={setRange}
						select={switchClip}
					/>
				))}
			</div>
		</div>
	);
}

function RangeOverlay({
	item,
	duration,
	maximumDuration,
	selected,
	save,
	select,
}: {
	item: LocalClipItemV1;
	duration: number;
	maximumDuration: number;
	selected: boolean;
	save: BatchContextValue["setRange"];
	select: BatchContextValue["switchClip"];
}) {
	const [range, setLocalRange] = useState({
		start: item.sourceStartMs,
		end: item.sourceEndMs,
	});
	const left = (range.start / duration) * 100;
	const width = ((range.end - range.start) / duration) * 100;
	function drag(
		mode: ClipRangeAdjustment,
		event: ReactPointerEvent<HTMLElement>,
	) {
		const lane = event.currentTarget.closest<HTMLElement>(
			"[data-clip-range-lane]",
		);
		if (!lane) return;
		const originX = event.clientX;
		const initial = { ...range };
		let latest = initial;
		const move = (pointer: PointerEvent) => {
			const delta = Math.round(
				((pointer.clientX - originX) / lane.getBoundingClientRect().width) *
					duration,
			);
			const adjusted = adjustClipRange({
				range: { sourceStartMs: initial.start, sourceEndMs: initial.end },
				mode,
				deltaMs: delta,
				sourceDurationMs: duration,
				maximumDurationMs: maximumDuration,
			});
			latest = { start: adjusted.sourceStartMs, end: adjusted.sourceEndMs };
			setLocalRange(latest);
		};
		const up = () => {
			window.removeEventListener("pointermove", move);
			void save(item, latest.start, latest.end);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up, { once: true });
	}
	function keyboard(mode: ClipRangeAdjustment, delta: number) {
		const adjusted = adjustClipRange({
			range: {
				sourceStartMs: item.sourceStartMs,
				sourceEndMs: item.sourceEndMs,
			},
			mode,
			deltaMs: delta,
			sourceDurationMs: duration,
			maximumDurationMs: maximumDuration,
		});
		void save(item, adjusted.sourceStartMs, adjusted.sourceEndMs);
	}
	return (
		<div
			data-testid="clip-range"
			data-clip-item-id={item.id}
			className={`absolute top-0 h-full min-w-8 rounded border-2 border-primary bg-primary/25 text-[10px] focus-within:ring-2 ${selected ? "bg-primary/50" : ""}`}
			style={{ left: `${left}%`, width: `${width}%` }}
			title={`${item.title}: ${formatMs(range.start)}–${formatMs(range.end)}`}
		>
			<button
				aria-label={`Adjust ${item.title} start`}
				className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-primary/60"
				onPointerDown={(event) => drag("start", event)}
				onKeyDown={(event) => {
					if (event.key === "ArrowLeft") keyboard("start", -100);
					if (event.key === "ArrowRight") keyboard("start", 100);
				}}
			/>
			<button
				className="flex h-full w-full cursor-grab items-center justify-center truncate px-2"
				onClick={() => void select(item.id)}
				onPointerDown={(event) => drag("body", event)}
				onKeyDown={(event) => {
					if (event.key === "ArrowLeft") keyboard("body", -100);
					if (event.key === "ArrowRight") keyboard("body", 100);
				}}
			>
				{item.ordinal} · {item.title}
			</button>
			<button
				aria-label={`Adjust ${item.title} end`}
				className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-primary/60"
				onPointerDown={(event) => drag("end", event)}
				onKeyDown={(event) => {
					if (event.key === "ArrowLeft") keyboard("end", -100);
					if (event.key === "ArrowRight") keyboard("end", 100);
				}}
			/>
		</div>
	);
}

function CreateDialog(props: {
	modal: boolean;
	setModal: (value: boolean) => void;
	count: number;
	setCount: (value: number) => void;
	maximumDurationSeconds: number;
	setMaximumDurationSeconds: (value: number) => void;
	platformPreset: LocalClipPlatformPresetV1;
	setPlatformPreset: (value: LocalClipPlatformPresetV1) => void;
	captionsEnabled: boolean;
	setCaptionsEnabled: (value: boolean) => void;
	headingsEnabled: boolean;
	setHeadingsEnabled: (value: boolean) => void;
	busy: boolean;
	makeBatch: () => Promise<void>;
}) {
	return (
		<Dialog open={props.modal} onOpenChange={props.setModal}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Create clip ranges</DialogTitle>
				</DialogHeader>
				<div className="space-y-4">
					<div>
						<Label htmlFor="clip-count">Number of clips</Label>
						<Input
							id="clip-count"
							type="number"
							min={1}
							max={12}
							value={props.count}
							onChange={(event) =>
								props.setCount(
									Math.max(1, Math.min(12, Number(event.target.value))),
								)
							}
						/>
					</div>
					<div>
						<Label htmlFor="clip-maximum-duration">
							Maximum duration (seconds)
						</Label>
						<Input
							id="clip-maximum-duration"
							type="number"
							min={1}
							max={180}
							value={props.maximumDurationSeconds}
							onChange={(event) =>
								props.setMaximumDurationSeconds(
									Math.max(1, Math.min(180, Number(event.target.value))),
								)
							}
						/>
					</div>
					<div>
						<Label htmlFor="clip-platform">Platform / aspect ratio</Label>
						<Select
							value={props.platformPreset}
							onValueChange={(value) =>
								props.setPlatformPreset(parsePlatform(value))
							}
						>
							<SelectTrigger id="clip-platform">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="instagram_reels">Instagram Reels</SelectItem>
								<SelectItem value="youtube_shorts">YouTube Shorts</SelectItem>
								<SelectItem value="tiktok">TikTok</SelectItem>
								<SelectItem value="custom">Current custom ratio</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<div className="flex items-center gap-2">
						<Checkbox
							id="clip-captions"
							checked={props.captionsEnabled}
							onCheckedChange={(value) =>
								props.setCaptionsEnabled(value === true)
							}
						/>
						<Label htmlFor="clip-captions">Add captions</Label>
					</div>
					<div className="flex items-center gap-2">
						<Checkbox
							id="clip-headings"
							checked={props.headingsEnabled}
							onCheckedChange={(value) =>
								props.setHeadingsEnabled(value === true)
							}
						/>
						<Label htmlFor="clip-headings">Add heading text</Label>
					</div>
					<p className="text-xs text-muted-foreground">
						Hard maximum: 180 seconds · Browser limit: 12 clips
					</p>
				</div>
				<DialogFooter>
					<Button disabled={props.busy} onClick={() => void props.makeBatch()}>
						Create clips
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function useBatch() {
	const value = useContext(BatchContext);
	if (!value) throw new Error("Clipping Mode is unavailable.");
	return value;
}

function assertValidClip({
	batch,
	item,
}: {
	batch: LocalClipBatchV1;
	item: LocalClipItemV1;
}) {
	if (
		item.sourceStartMs < 0 ||
		item.sourceEndMs <= item.sourceStartMs ||
		item.sourceEndMs > batch.sourceDurationMs ||
		item.sourceEndMs - item.sourceStartMs > batch.maximumClipDurationMs ||
		item.sourceEndMs - item.sourceStartMs > 180_000
	)
		throw new Error(`${item.title} has an invalid range.`);
}

function formatMs(value: number) {
	const safe = Math.max(0, value);
	const seconds = Math.floor(safe / 1000);
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}.${String(safe % 1000).padStart(3, "0")}`;
}

function parsePlatform(value: string): LocalClipPlatformPresetV1 {
	return value === "youtube_shorts" || value === "tiktok" || value === "custom"
		? value
		: "instagram_reels";
}
