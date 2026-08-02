/* eslint-disable opencut/prefer-object-params -- Pointer helpers and tiny local callbacks are clearer positionally. */
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CapinstaApiError } from "@/capinsta/apiClient";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEditor } from "@/editor/use-editor";
import { mediaTimeFromSeconds } from "@/wasm";
import { storageService } from "@/services/storage/service";
import {
	addClipBatchItem,
	createClipBatchExport,
	deleteClipBatch,
	deleteClipBatchSourceMedia,
	deleteClipBatchItem,
	deleteMaterializedClipProject,
	finalizeClipBatchExport,
	getClipBatch,
	getClipBatchExport,
	getClipBatchExportDownload,
	getClipCaption,
	materializeClipBatch,
	reorderClipBatchItems,
	resetClipBatchItem,
	startClipCaption,
	syncClipEditorProject,
	updateClipBatch,
	updateClipBatchItem,
	type ClipBatchItemV1,
	type ClipBatchV1,
} from "@/services/clip-batches/api";
import { createExport, getExport, getExportDownload, getProjectStatus, prepareHandoff, requestConversion } from "@/services/automatic-clipper/api";
import { adjustClipRange, initialClipRanges, type ClipRangeAdjustment } from "@/services/clip-batches/ranges";

type BatchContextValue = {
	batch: ClipBatchV1;
	reload: () => Promise<void>;
	setRange: (item: ClipBatchItemV1, start: number, end: number) => Promise<void>;
};
const BatchContext = createContext<BatchContextValue | null>(null);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function useBatch() {
	const value = useContext(BatchContext);
	if (!value) throw new Error("Clip batch context is unavailable");
	return value;
}

export function ClipBatchProvider({ children }: { children: ReactNode }) {
	const searchParams = useSearchParams();
	const batchId = searchParams.get("clipBatch");
	const [batch, setBatch] = useState<ClipBatchV1 | null>(null);
	const reload = useCallback(async () => {
		if (batchId) setBatch(await getClipBatch(batchId));
	}, [batchId]);
	useEffect(() => {
		if (batchId) void getClipBatch(batchId).then(setBatch);
	}, [batchId]);

	const value = useMemo<BatchContextValue | null>(
		() =>
			batch
				? {
						batch,
						reload,
						setRange: async (item, sourceStartMs, sourceEndMs) => {
							await updateClipBatchItem(batch.id, item.id, { expectedRevision: item.revision, sourceStartMs, sourceEndMs });
							await reload();
						},
					}
				: null,
		[batch, reload],
	);
	return <BatchContext.Provider value={value}>{children}</BatchContext.Provider>;
}

export function ClipBatchDock() {
	const value = useContext(BatchContext);
	if (!value) return null;
	return <ClipBatchDockContent />;
}

function ClipBatchDockContent() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const editor = useEditor();
	const { batch, reload } = useBatch();
	const [modal, setModal] = useState(false);
	const [count, setCount] = useState(5);
	const [captions, setCaptions] = useState(batch.captionsEnabled);
	const [headings, setHeadings] = useState(batch.headingsEnabled);
	const [platform, setPlatform] = useState<ClipBatchV1["platformPreset"]>(batch.platformPreset);
	const [maximumDurationSeconds, setMaximumDurationSeconds] = useState(Math.min(60, batch.maximumClipDurationMs / 1000));
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const [captioning, setCaptioning] = useState(false);
	const cancelRemainingCaptions = useRef(false);

	async function generateCaption(item: ClipBatchItemV1, index = 0, total = 1) {
		setMessage(`Generating captions - Clip ${index + 1} of ${total}`);
		await startClipCaption(batch.id, item.id);
		for (let attempt = 0; attempt < 600; attempt += 1) {
			const job = await getClipCaption(batch.id, item.id);
			if (job.status === "completed") return;
			if (["failed", "cancelled"].includes(job.status)) throw new Error(`Captions could not be generated for ${item.title}.`);
			await wait(1_000);
		}
		throw new Error(`Caption generation timed out for ${item.title}. You can safely retry.`);
	}

	async function captionItem(item: ClipBatchItemV1) {
		if (captioning) return;
		setCaptioning(true);
		try {
			await generateCaption(item);
			await reload();
			setMessage(`Captions are ready for ${item.title}.`);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : `Captions could not be generated for ${item.title}.`);
		} finally {
			setCaptioning(false);
		}
	}

	async function createRegions() {
		setBusy(true);
		try {
			const maximumClipDurationMs = Math.round(maximumDurationSeconds * 1000);
			let current = await updateClipBatch(batch.id, { expectedRevision: batch.revision, captionsEnabled: captions, headingsEnabled: headings, platformPreset: platform, maximumClipDurationMs });
			for (const [index, range] of initialClipRanges({ sourceDurationMs: batch.sourceDurationMs, count, maximumDurationMs: maximumClipDurationMs }).entries()) {
				await addClipBatchItem(batch.id, { title: `Clip ${index + 1}`, ...range });
			}
			current = await getClipBatch(batch.id);
			setModal(false);
			await reload();
			setMessage(`${current.items.length} clip regions created. Adjust them on the timeline.`);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "The clip regions could not be created.");
		} finally {
			setBusy(false);
		}
	}

	async function materialize() {
		setBusy(true);
		setMessage("Creating independent editable clips…");
		try {
			await materializeClipBatch(await getClipBatch(batch.id));
			const current = await getClipBatch(batch.id);
			await reload();
			if (current.captionsEnabled) {
				cancelRemainingCaptions.current = false;
				setCaptioning(true);
				const selected = current.items.filter((item) => item.selectedForExport);
				for (const [index, item] of selected.entries()) {
					if (cancelRemainingCaptions.current) break;
					try {
						await generateCaption(item, index, selected.length);
					} catch (error) {
						setMessage(error instanceof Error ? error.message : `Captions could not be generated for ${item.title}.`);
					}
				}
				setCaptioning(false);
				await reload();
			}
			setMessage("Clip projects are ready.");
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "The clip projects could not be created.");
		} finally {
			setCaptioning(false);
			setBusy(false);
		}
	}

	async function deleteBatchAndClips() {
		if (!window.confirm("Delete this clip batch and its child clip projects? The shared source video will be preserved.")) return;
		setBusy(true);
		try {
			const projectIds = new Set([
				...(batch.sourceProjectId ? [batch.sourceProjectId] : []),
				...batch.items.flatMap((item) => item.childProjectId ? [item.childProjectId] : []),
			]);
			for (const projectId of projectIds) {
				await deleteMaterializedClipProject(projectId);
				await Promise.all([
					storageService.deleteProjectMedia({ projectId }),
					storageService.deleteProject({ id: projectId }),
				]);
			}
			await deleteClipBatch(batch.id);
			try {
				await deleteClipBatchSourceMedia(batch.sourceMediaAssetId);
			} catch (error) {
				if (!(error instanceof CapinstaApiError) || error.diagnostics?.code !== "media_asset_not_ready") throw error;
			}
			window.localStorage.removeItem("capinsta:manual-clip-batch-v1");
			router.push("/clipper");
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "The clip batch could not be deleted.");
		} finally {
			setBusy(false);
		}
	}

	async function openItem(item: ClipBatchItemV1) {
		if (!item.childProjectId || !item.childProjectRevision) return;
		setBusy(true);
		try {
			await editor.project.saveCurrentProject();
			let requested = false;
			let converted = false;
			for (let attempt = 0; attempt < 600; attempt += 1) {
				const status = await getProjectStatus(item.childProjectId);
				const derivation = Reflect.get(status, "derivation") ?? {};
				const conversion = Reflect.get(Reflect.get(status, "conversion") ?? {}, "status");
				if (conversion === "current" || conversion === "succeeded") {
					converted = true;
					break;
				}
				if (Reflect.get(derivation, "status") === "failed" || conversion === "failed") throw new Error("The editable clip could not be prepared.");
				if (!requested && (Reflect.get(derivation, "status") === "succeeded" || Reflect.get(derivation, "edl") === "current")) {
					await requestConversion(item.childProjectId, item.childProjectRevision, `clipper-item-${item.id}`, false);
					requested = true;
				}
				await wait(1_000);
			}
			if (!converted) throw new Error("Preparing the editable clip timed out. You can safely retry.");
			const handoff = await prepareHandoff(item.childProjectId, item.childProjectRevision, `clipper-item-${item.id}`, false);
			router.push(`/editor/handoff/${handoff.handoffId}?clipBatch=${batch.id}&clipItem=${item.id}`);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : `${item.title} could not be opened.`);
		} finally {
			setBusy(false);
		}
	}

	async function exportItems(items: ClipBatchItemV1[]) {
		if (!items.length) return setMessage("Select at least one clip to export.");
		setBusy(true);
		try {
			await editor.project.saveCurrentProject();
			const selectedIds = new Set(items.map((item) => item.id));
			let current = await getClipBatch(batch.id);
			items = current.items.filter((item) => selectedIds.has(item.id));
			for (const item of items) {
				if (!item.childProjectId) continue;
				const saved = await storageService.loadProject({ id: item.childProjectId });
				if (saved?.project.capinstaClippingProvenance?.sourceClipProjectRevision === item.childProjectRevision)
					await syncClipEditorProject(batch.id, item, saved.project);
			}
			current = await getClipBatch(batch.id);
			items = current.items.filter((item) => selectedIds.has(item.id));
			await reload();
			setMessage(`Exporting ${items.length === 1 ? items[0].title : `${items.length} clips`}\u2026`);
			if (items.length === 1) {
				const item = items[0];
				if (!item.childProjectId || !item.childProjectRevision) throw new Error("Confirm this clip before exporting it.");
				const created = await createExport(item.childProjectId, item.childProjectRevision, item.captionStatus === "completed");
				for (let attempt = 0; attempt < 7_200; attempt += 1) {
					const value = await getExport(created.exportId);
					const status = String(Reflect.get(value, "status"));
					if (status === "ready") {
						window.location.assign(await getExportDownload(created.exportId));
						setMessage("Export ready.");
						return;
					}
					if (["failed", "cancelled", "expired"].includes(status)) throw new Error(`Export ${status}.`);
					await wait(1_000);
				}
				throw new Error("Export timed out. You can safely retry.");
			}
			let value = await createClipBatchExport(current, items.map((item) => item.id));
			for (let attempt = 0; attempt < 7_200 && value.status === "processing"; attempt += 1) {
				await wait(1_000);
				value = await getClipBatchExport(batch.id, value.id);
			}
			if (value.status === "ready_for_zip") {
				setMessage("Preparing ZIP\u2026");
				value = await finalizeClipBatchExport(batch.id, value.id);
			}
			if (value.status !== "ready") throw new Error("One or more clips could not be exported.");
			window.location.assign((await getClipBatchExportDownload(batch.id, value.id)).url);
			setMessage("Export ready.");
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "The clips could not be exported.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<section className="border-b p-3" aria-label="Clip batch" data-testid="clip-batch-dock">
			<div className="mb-2 flex items-center justify-between"><strong className="text-sm">Clips</strong><div className="flex gap-1"><Button variant="ghost" size="sm" disabled={busy} onClick={() => void deleteBatchAndClips()}>Delete batch</Button><Button size="sm" onClick={() => setModal(true)}>Create clips</Button></div></div>
			<div className="max-h-56 space-y-2 overflow-auto">
				{batch.items.map((item, index) => (
					<ClipItemRow key={item.id} item={item} onOpen={() => void openItem(item)} onCaption={() => void captionItem(item)} onReload={reload} onMove={(delta) => {
						const ids = batch.items.map((candidate) => candidate.id);
						const target = index + delta;
						if (target < 0 || target >= ids.length) return;
						[ids[index], ids[target]] = [ids[target], ids[index]];
						void reorderClipBatchItems(batch, ids).then(reload);
					}} />
				))}
			</div>
			{batch.items.length ? <div className="mt-3 grid grid-cols-2 gap-2"><Button disabled={busy} onClick={() => void materialize()}>Confirm ranges</Button><Button variant="outline" disabled={busy} onClick={() => void exportItems(batch.items.filter((item) => item.selectedForExport))}>Export selected</Button><Button variant="outline" disabled={busy} onClick={() => void exportItems(batch.items)}>Export all</Button><Button variant="outline" disabled={busy || !searchParams.get("clipItem")} onClick={() => void exportItems(batch.items.filter((item) => item.id === searchParams.get("clipItem")))}>Export current</Button></div> : null}
			{captioning ? <Button className="mt-2 w-full" variant="outline" onClick={() => { cancelRemainingCaptions.current = true; setMessage("Finishing the current clip; remaining captions are cancelled."); }}>Cancel remaining captions</Button> : null}
			{message ? <p className="mt-2 text-xs text-muted-foreground" role="status">{message}</p> : null}
			<Dialog open={modal} onOpenChange={setModal}>
				<DialogContent>
					<DialogHeader><DialogTitle>Create clip regions</DialogTitle></DialogHeader>
					<div className="space-y-4">
						<div><Label htmlFor="clip-count">Number of clips</Label><Input id="clip-count" type="number" min={1} max={12} value={count} onChange={(event) => setCount(Math.max(1, Math.min(12, Number(event.target.value))))} /></div>
						<div><Label htmlFor="clip-maximum-duration">Maximum duration (seconds)</Label><Input id="clip-maximum-duration" type="number" min={1} max={180} value={maximumDurationSeconds} onChange={(event) => setMaximumDurationSeconds(Math.max(1, Math.min(180, Number(event.target.value))))} /></div>
						<div><Label htmlFor="clip-platform">Platform</Label><Select value={platform} onValueChange={(value) => { const selected = parsePlatform(value); setPlatform(selected); setMaximumDurationSeconds(selected === "custom" ? 180 : 60); }}><SelectTrigger id="clip-platform"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="instagram_reels">Instagram Reels</SelectItem><SelectItem value="youtube_shorts">YouTube Shorts</SelectItem><SelectItem value="tiktok">TikTok</SelectItem><SelectItem value="custom">Custom</SelectItem></SelectContent></Select></div>
						<div className="flex items-center gap-2"><Checkbox id="clip-captions" checked={captions} onCheckedChange={(value) => setCaptions(value === true)} /><Label htmlFor="clip-captions">Add captions</Label></div>
						<div className="flex items-center gap-2"><Checkbox id="clip-headings" checked={headings} onCheckedChange={(value) => setHeadings(value === true)} /><Label htmlFor="clip-headings">Add headings</Label></div>
						<p className="text-xs text-muted-foreground">Hard maximum: 3:00</p>
					</div>
					<DialogFooter><Button disabled={busy} onClick={() => void createRegions()}>Create clip regions</Button></DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}

function ClipItemRow({ item, onOpen, onCaption, onReload, onMove }: { item: ClipBatchItemV1; onOpen: () => void; onCaption: () => void; onReload: () => Promise<void>; onMove: (delta: number) => void }) {
	const { batch } = useBatch();
	const editor = useEditor();
	const isChildEditor = Boolean(useSearchParams().get("clipItem"));
	const [title, setTitle] = useState(item.title);
	const [start, setStart] = useState(item.sourceStartMs);
	const [end, setEnd] = useState(item.sourceEndMs);
	const previewTimer = useRef<number | null>(null);
	useEffect(() => () => {
		if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
	}, []);
	const invalid = end <= start || end - start > batch.maximumClipDurationMs || end > batch.sourceDurationMs;
	async function remove() {
		if (!window.confirm(`Remove ${item.title}${item.childProjectId ? " and its editable project" : ""}?`)) return;
		const projectId = item.childProjectId;
		await deleteClipBatchItem(batch.id, item.id);
		if (projectId) {
			await Promise.all([
				storageService.deleteProjectMedia({ projectId }),
				storageService.deleteProject({ id: projectId }),
			]);
		}
		await onReload();
	}
	async function resetEdits() {
		if (!item.childProjectId || !window.confirm(`Reset ${item.title}? Its edits, headings, captions, and exports will be discarded.`)) return;
		const projectId = item.childProjectId;
		await resetClipBatchItem(batch.id, item.id);
		await Promise.all([
			storageService.deleteProjectMedia({ projectId }),
			storageService.deleteProject({ id: projectId }),
		]);
		await onReload();
	}
	return (
		<div className="rounded border p-2 text-xs" data-testid="clip-batch-item" data-clip-item-id={item.id}>
			<div className="flex items-center gap-1"><Checkbox checked={item.selectedForExport} onCheckedChange={(checked) => void updateClipBatchItem(batch.id, item.id, { expectedRevision: item.revision, selectedForExport: checked === true }).then(onReload)} /><Button variant="ghost" size="sm" onClick={onOpen}>{item.ordinal}</Button><Input aria-label={`Title for clip ${item.ordinal}`} className="h-7 min-w-0" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} /><Button variant="ghost" size="sm" onClick={() => onMove(-1)} aria-label="Move clip up">Up</Button><Button variant="ghost" size="sm" onClick={() => onMove(1)} aria-label="Move clip down">Down</Button></div>
			<div className="mt-1 grid grid-cols-2 gap-1"><div><Label htmlFor={`clip-start-${item.id}`}>Start ms</Label><Input id={`clip-start-${item.id}`} className="h-7" type="number" min={0} disabled={Boolean(item.childProjectId)} value={start} onChange={(event) => setStart(Number(event.target.value))} /></div><div><Label htmlFor={`clip-end-${item.id}`}>End ms</Label><Input id={`clip-end-${item.id}`} className="h-7" type="number" min={1} disabled={Boolean(item.childProjectId)} value={end} onChange={(event) => setEnd(Number(event.target.value))} /></div></div>
			<div className="mt-1 flex items-center justify-between"><span className={invalid ? "text-destructive" : "text-muted-foreground"}>{formatMs(end - start)}{invalid ? " · invalid" : ""} · captions: {item.captionStatus} · heading: {item.headingStatus}</span><div><Button variant="ghost" size="sm" disabled={isChildEditor} onClick={() => { if (previewTimer.current !== null) window.clearTimeout(previewTimer.current); editor.playback.seek({ time: mediaTimeFromSeconds({ seconds: item.sourceStartMs / 1000 }) }); editor.playback.play(); previewTimer.current = window.setTimeout(() => editor.playback.pause(), item.durationMs); }}>Preview</Button><Button variant="ghost" size="sm" disabled={invalid || !title.trim()} onClick={() => void updateClipBatchItem(batch.id, item.id, { expectedRevision: item.revision, title: title.trim(), sourceStartMs: start, sourceEndMs: end }).then(onReload)}>Save</Button>{item.childProjectId ? <><Button variant="ghost" size="sm" onClick={onCaption}>Captions</Button><Button variant="ghost" size="sm" disabled={isChildEditor} onClick={() => void resetEdits()}>Reset edits</Button></> : null}<Button variant="ghost" size="sm" onClick={() => void addClipBatchItem(batch.id, { title: `${item.title} copy`, sourceStartMs: item.sourceStartMs, sourceEndMs: item.sourceEndMs }).then(onReload)}>Duplicate</Button><Button variant="ghost" size="sm" onClick={() => void remove()}>Remove</Button></div></div>
		</div>
	);
}

export function ClipRangeLane() {
	const value = useContext(BatchContext);
	const isChildEditor = Boolean(useSearchParams().get("clipItem"));
	if (!value || !value.batch.items.length || isChildEditor) return null;
	return <ClipRangeLaneContent />;
}

function ClipRangeLaneContent() {
	const { batch, setRange } = useBatch();
	const selectedItemId = useSearchParams().get("clipItem");
	return (
		<div className="h-14 border-y bg-muted/30 px-2 py-1" aria-label="Clip ranges">
			<div className="relative h-full" data-clip-range-lane data-testid="clip-range-lane">
				{batch.items.map((item) => <RangeOverlay key={`${item.id}:${item.revision}`} item={item} duration={batch.sourceDurationMs} maximumDuration={batch.maximumClipDurationMs} selected={item.id === selectedItemId} save={setRange} />)}
			</div>
		</div>
	);
}

function RangeOverlay({ item, duration, maximumDuration, selected, save }: { item: ClipBatchItemV1; duration: number; maximumDuration: number; selected: boolean; save: BatchContextValue["setRange"] }) {
	const [range, setLocalRange] = useState({ start: item.sourceStartMs, end: item.sourceEndMs });
	const left = (range.start / duration) * 100;
	const width = ((range.end - range.start) / duration) * 100;
	if (item.childProjectId) return <div data-testid="clip-range" data-clip-item-id={item.id} className={`absolute top-0 h-full min-w-8 rounded border-2 border-primary bg-primary/25 text-[10px] ${selected ? "bg-primary/50" : ""}`} style={{ left: `${left}%`, width: `${width}%` }} title={`${item.title}: reset edits before changing its range`}><span className="flex h-full items-center justify-center truncate px-2">{item.ordinal}</span></div>;
	function drag(mode: ClipRangeAdjustment, event: ReactPointerEvent<HTMLElement>) {
		const lane = event.currentTarget.closest<HTMLElement>("[data-clip-range-lane]");
		if (!lane) return;
		const originX = event.clientX;
		const initial = { ...range };
		let latest = initial;
		const move = (pointer: PointerEvent) => {
			const delta = Math.round(((pointer.clientX - originX) / lane.getBoundingClientRect().width) * duration);
			const adjusted = adjustClipRange({ range: { sourceStartMs: initial.start, sourceEndMs: initial.end }, mode, deltaMs: delta, sourceDurationMs: duration, maximumDurationMs: maximumDuration });
			latest = { start: adjusted.sourceStartMs, end: adjusted.sourceEndMs };
			setLocalRange(latest);
		};
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			if (latest.end - latest.start <= maximumDuration) void save(item, latest.start, latest.end);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up, { once: true });
	}
	function keyboard(edge: "start" | "end", delta: number) {
		const adjusted = adjustClipRange({ range: { sourceStartMs: item.sourceStartMs, sourceEndMs: item.sourceEndMs }, mode: edge, deltaMs: delta, sourceDurationMs: duration, maximumDurationMs: maximumDuration });
		void save(item, adjusted.sourceStartMs, adjusted.sourceEndMs);
	}
	return (
		<div data-testid="clip-range" data-clip-item-id={item.id} className={`absolute top-0 h-full min-w-8 rounded border-2 border-primary bg-primary/25 text-[10px] transition hover:bg-primary/40 focus-within:ring-2 ${selected ? "bg-primary/50" : ""}`} style={{ left: `${left}%`, width: `${width}%` }} title={`${item.title}: ${formatMs(range.start)}–${formatMs(range.end)}`}>
			<button aria-label={`Adjust ${item.title} start`} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-primary/60" onPointerDown={(event) => drag("start", event)} onKeyDown={(event) => { if (event.key === "ArrowLeft") keyboard("start", -100); if (event.key === "ArrowRight") keyboard("start", 100); }} />
			<button className="flex h-full w-full cursor-grab items-center justify-center truncate px-2" onPointerDown={(event) => drag("body", event)}>{item.ordinal}</button>
			<button aria-label={`Adjust ${item.title} end`} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-primary/60" onPointerDown={(event) => drag("end", event)} onKeyDown={(event) => { if (event.key === "ArrowLeft") keyboard("end", -100); if (event.key === "ArrowRight") keyboard("end", 100); }} />
		</div>
	);
}

function formatMs(value: number) {
	const seconds = Math.floor(value / 1000);
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}.${String(value % 1000).padStart(3, "0")}`;
}

function parsePlatform(value: string): ClipBatchV1["platformPreset"] {
	if (value === "instagram_reels" || value === "youtube_shorts" || value === "tiktok" || value === "custom") return value;
	return "instagram_reels";
}
