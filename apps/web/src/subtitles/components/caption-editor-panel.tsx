"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal, Play, Plus, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Section,
	SectionContent,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import type {
	CapinstaCaptionDocumentRecord,
	NeutralCaptionClip,
	NeutralCaptionDocument,
	NeutralCaptionWord,
} from "@/capinsta/types";
import {
	addSegment,
	addWord,
	deleteSegment,
	deleteWord,
	formatSubtitleTime,
	mergeSegments,
	parseSubtitleTime,
	replaceCaptionText,
	splitSegment,
	updateSegmentText,
	updateSegmentTiming,
	updateWord,
	validateSegmentTiming,
} from "@/capinsta/captionEditing";
import { UpdateCapinstaCaptionDocumentCommand } from "@/commands";
import { useEditor } from "@/editor/use-editor";
import { frameRateToFloat } from "@/fps/utils";
import {
	mediaTimeFromSeconds,
	mediaTimeToSeconds,
	type MediaTime,
} from "@/wasm";
import { resolveCapinstaElementForClip } from "@/capinsta/captionTimelineSync";
import { cn } from "@/utils/ui";

function clipWords({
	document,
	clip,
}: {
	document: NeutralCaptionDocument;
	clip: NeutralCaptionClip;
}): NeutralCaptionWord[] {
	const lookup = new Map(document.words.map((word) => [word.id, word]));
	return clip.wordIds
		.map((id) => lookup.get(id))
		.filter((word): word is NeutralCaptionWord => Boolean(word));
}

function captionProviderLabel(document: NeutralCaptionDocument): string {
	const provider = document.sourceTranscriptRef.provider.toLowerCase();
	const fallback = document.sourceTranscriptRef.providerFallback;
	if (provider === "gemini") return "Generated with Gemini AI";
	if (provider === "sarvam") {
		return fallback
			? "Generated via Sarvam AI [Fallback]"
			: "Generated with Sarvam AI";
	}
	if (provider === "openai_whisper") return "Generated with OpenAI Whisper";
	if (provider === "groq_whisper") return "Generated with Groq Whisper";
	return `Generated with ${document.sourceTranscriptRef.provider}`;
}

function TimeInput({
	label,
	value,
	min,
	max,
	fps,
	onCommit,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	fps: number;
	onCommit: (value: number) => void;
}) {
	const [draft, setDraft] = useState(() => formatSubtitleTime(value));
	const [error, setError] = useState<string | null>(null);
	const [editing, setEditing] = useState(false);
	useEffect(() => setDraft(formatSubtitleTime(value)), [value]);
	const commit = useCallback(() => {
		const parsed = parseSubtitleTime(draft);
		if (parsed === null || parsed < min || parsed > max) {
			setError("Invalid time");
			return;
		}
		setError(null);
		onCommit(parsed);
		setDraft(formatSubtitleTime(parsed));
		setEditing(false);
	}, [draft, max, min, onCommit]);
	if (!editing) {
		return (
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="h-auto justify-start px-1 font-mono text-[10px] text-muted-foreground"
				aria-label={`Edit ${label.toLowerCase()}`}
				onClick={() => setEditing(true)}
			>
				{formatSubtitleTime(value).slice(3)}
			</Button>
		);
	}
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<label className="sr-only">{label}</label>
			<Input
				autoFocus
				value={draft}
				aria-label={label}
				aria-invalid={Boolean(error)}
				className="font-mono text-xs"
				onChange={(event) => setDraft(event.target.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						commit();
					} else if (event.key === "Escape") {
						setDraft(formatSubtitleTime(value));
						setError(null);
						setEditing(false);
					} else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
						event.preventDefault();
						const parsed = parseSubtitleTime(draft) ?? value;
						const direction = event.key === "ArrowUp" ? 1 : -1;
						const step = (event.shiftKey ? 10 : 1) / fps;
						const next = Math.max(
							min,
							Math.min(max, parsed + direction * step),
						);
						setDraft(formatSubtitleTime(next));
					}
				}}
			/>
			{error ? (
				<span className="text-destructive text-[11px]">{error}</span>
			) : null}
		</div>
	);
}

const SubtitleRow = memo(function SubtitleRow({
	document,
	clip,
	index,
	active,
	selected,
	fps,
	onSelect,
	onPlay,
	onChange,
	onDelete,
	onMergePrevious,
	onMergeNext,
	onAddBefore,
	onAddAfter,
	onSplit,
	onEditingChange,
}: {
	document: NeutralCaptionDocument;
	clip: NeutralCaptionClip;
	index: number;
	active: boolean;
	selected: boolean;
	fps: number;
	onSelect: () => void;
	onPlay: () => void;
	onChange: (document: NeutralCaptionDocument) => void;
	onDelete: () => void;
	onMergePrevious: () => void;
	onMergeNext: () => void;
	onAddBefore: () => void;
	onAddAfter: () => void;
	onSplit: (characterIndex: number) => void;
	onEditingChange: (editing: boolean) => void;
}) {
	const [text, setText] = useState(clip.text);
	const [wordsOpen, setWordsOpen] = useState(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const textCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => setText(clip.text), [clip.text]);
	useEffect(
		() => () => {
			if (textCommitTimerRef.current) clearTimeout(textCommitTimerRef.current);
		},
		[],
	);
	const words = clipWords({ document, clip });
	const commitText = () => {
		if (textCommitTimerRef.current) {
			clearTimeout(textCommitTimerRef.current);
			textCommitTimerRef.current = null;
		}
		if (text !== clip.text) {
			onChange(updateSegmentText({ document, clipId: clip.id, text }));
		}
		onEditingChange(false);
	};
	return (
		<article
			data-caption-row={clip.id}
			className={cn(
				"group border-b px-2 py-2 transition-colors",
				active && "border-l-2 border-l-primary bg-primary/5",
				selected && "bg-accent/60",
			)}
			onClick={onSelect}
		>
			<div className="mb-1 flex items-center justify-between">
				<span className="text-muted-foreground text-[10px]">
					Caption {index + 1}
				</span>
				<div
					className={cn(
						"flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100",
						selected && "opacity-100",
					)}
				>
					<Button
						type="button"
						size="icon"
						variant="ghost"
						aria-label="Play subtitle"
						onClick={(event) => {
							event.stopPropagation();
							onPlay();
						}}
					>
						<Play />
					</Button>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								size="icon"
								variant="ghost"
								aria-label="Subtitle actions"
							>
								<MoreHorizontal />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuGroup>
								<DropdownMenuItem
									onSelect={() => setWordsOpen((value) => !value)}
								>
									{wordsOpen ? "Close word editor" : "Edit words"}
								</DropdownMenuItem>
								<DropdownMenuItem
									onSelect={() =>
										onSplit(
											textareaRef.current?.selectionStart ??
												Math.floor(text.length / 2),
										)
									}
								>
									Split segment
								</DropdownMenuItem>
								<DropdownMenuItem
									disabled={index === 0}
									onSelect={onMergePrevious}
								>
									Merge with previous
								</DropdownMenuItem>
								<DropdownMenuItem
									disabled={index === document.clips.length - 1}
									onSelect={onMergeNext}
								>
									Merge with next
								</DropdownMenuItem>
								<DropdownMenuItem onSelect={onAddBefore}>
									Add subtitle before
								</DropdownMenuItem>
								<DropdownMenuItem onSelect={onAddAfter}>
									Add subtitle after
								</DropdownMenuItem>
								{clip.manualEdit?.originalStart !== undefined ? (
									<DropdownMenuItem
										onSelect={() =>
											onChange(
												updateSegmentTiming({
													document,
													clipId: clip.id,
													start: clip.manualEdit!.originalStart!,
													end: clip.manualEdit!.originalEnd!,
												}),
											)
										}
									>
										Reset timing changes
									</DropdownMenuItem>
								) : null}
								<DropdownMenuItem variant="destructive" onSelect={onDelete}>
									Delete subtitle
								</DropdownMenuItem>
							</DropdownMenuGroup>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
			<div className="grid grid-cols-[5.5rem_minmax(0,1fr)_5.5rem] items-start gap-1">
				<TimeInput
					label="Start time"
					value={clip.start}
					min={0}
					max={Math.max(0, clip.end - 0.001)}
					fps={fps}
					onCommit={(start) => {
						const error = validateSegmentTiming({
							start,
							end: clip.end,
							mediaDuration: document.durationSeconds,
						});
						if (!error)
							onChange(
								updateSegmentTiming({
									document,
									clipId: clip.id,
									start,
									end: clip.end,
								}),
							);
					}}
				/>
				<div className="flex min-w-0 flex-col">
					<label className="sr-only" htmlFor={`caption-${clip.id}`}>
						Subtitle text
					</label>
					<Textarea
						ref={textareaRef}
						id={`caption-${clip.id}`}
						value={text}
						rows={1}
						className="min-h-8 resize-none border-transparent bg-transparent px-1 py-1 text-sm shadow-none hover:bg-muted/40 focus-visible:border-border focus-visible:bg-background"
						onFocus={() => onEditingChange(true)}
						onChange={(event) => {
							const nextText = event.target.value;
							setText(nextText);
							if (textCommitTimerRef.current) {
								clearTimeout(textCommitTimerRef.current);
							}
							textCommitTimerRef.current = setTimeout(() => {
								textCommitTimerRef.current = null;
								if (nextText !== clip.text) {
									onChange(
										updateSegmentText({
											document,
											clipId: clip.id,
											text: nextText,
										}),
									);
								}
							}, 250);
						}}
						onBlur={commitText}
						onKeyDown={(event) => {
							if ((event.metaKey || event.ctrlKey) && event.key === "Enter")
								commitText();
						}}
					/>
				</div>
				<TimeInput
					label="End time"
					value={clip.end}
					min={clip.start + 0.001}
					max={document.durationSeconds}
					fps={fps}
					onCommit={(end) => {
						const error = validateSegmentTiming({
							start: clip.start,
							end,
							mediaDuration: document.durationSeconds,
						});
						if (!error)
							onChange(
								updateSegmentTiming({
									document,
									clipId: clip.id,
									start: clip.start,
									end,
								}),
							);
					}}
				/>
			</div>
			{wordsOpen ? (
				<div className="mt-2 flex flex-col gap-2 rounded-md bg-muted/30 p-2">
					{words.map((word, wordIndex) => (
						<div key={word.id} className="grid items-end gap-1 border-b pb-2">
							<div className="flex flex-col gap-1">
								<label className="text-muted-foreground text-[11px]">
									Word
								</label>
								<Input
									defaultValue={word.displayedText}
									onBlur={(event) =>
										onChange(
											updateWord({
												document,
												clipId: clip.id,
												wordId: word.id,
												text: event.target.value,
												start: word.start,
												end: word.end,
											}),
										)
									}
								/>
							</div>
							<TimeInput
								label="Word start"
								value={word.start}
								min={words[wordIndex - 1]?.end ?? clip.start}
								max={word.end - 0.001}
								fps={fps}
								onCommit={(start) =>
									onChange(
										updateWord({
											document,
											clipId: clip.id,
											wordId: word.id,
											text: word.displayedText,
											start,
											end: word.end,
										}),
									)
								}
							/>
							<TimeInput
								label="Word end"
								value={word.end}
								min={word.start + 0.001}
								max={words[wordIndex + 1]?.start ?? clip.end}
								fps={fps}
								onCommit={(end) =>
									onChange(
										updateWord({
											document,
											clipId: clip.id,
											wordId: word.id,
											text: word.displayedText,
											start: word.start,
											end,
										}),
									)
								}
							/>
							<Button
								type="button"
								size="icon"
								variant="ghost"
								aria-label="Delete word"
								onClick={() =>
									onChange(
										deleteWord({ document, clipId: clip.id, wordId: word.id }),
									)
								}
							>
								<Trash2 />
							</Button>
						</div>
					))}
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => onChange(addWord({ document, clipId: clip.id }))}
					>
						<Plus />
						Add word
					</Button>
				</div>
			) : null}
		</article>
	);
});

export function CaptionEditorPanel({
	record,
}: {
	record: CapinstaCaptionDocumentRecord | null;
}) {
	const editor = useEditor();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [activeId, setActiveId] = useState<string | null>(null);
	const [editing, setEditing] = useState(false);
	const [search, setSearch] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const [replacement, setReplacement] = useState("");
	const [resultIndex, setResultIndex] = useState(0);
	const scrollRef = useRef<HTMLDivElement>(null);
	const project = useEditor((core) => core.project.getActive());
	const currentRecord =
		project.capinstaCaptionDocuments?.find(
			(item) => item.document.id === record?.document.id,
		) ?? record;
	const document = currentRecord?.document ?? null;
	const fps = frameRateToFloat(project.settings.fps);
	const clips = useMemo(
		() => [...(document?.clips ?? [])].sort((a, b) => a.start - b.start),
		[document],
	);
	const providerLabel = document ? captionProviderLabel(document) : "";
	const reviewWarnings = useMemo(
		() =>
			clips.filter(
				(clip) =>
					clip.timingNeedsReview || clip.manualEdit?.timingReviewReason,
			),
		[clips],
	);
	const results = useMemo(
		() =>
			search
				? clips.filter((clip) =>
						clip.text.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
					)
				: [],
		[clips, search],
	);
	const commit = useCallback(
		(nextDocument: NeutralCaptionDocument) => {
			if (!currentRecord) return;
			editor.command.execute({
				command: new UpdateCapinstaCaptionDocumentCommand({
					...currentRecord,
					document: nextDocument,
				}),
			});
		},
		[currentRecord, editor],
	);
	const selectClip = useCallback(
		(clip: NeutralCaptionClip) => {
			if (!currentRecord) return;
			setSelectedId(clip.id);
			editor.playback.seek({
				time: mediaTimeFromSeconds({ seconds: clip.start }),
			});
			const element = resolveCapinstaElementForClip({
				record: currentRecord,
				tracks: editor.scenes.getActiveScene().tracks,
				clipId: clip.id,
			});
			if (element) {
				editor.selection.selectElement({
					element: {
						trackId: currentRecord.openCutTrackId,
						elementId: element.id,
					},
				});
			}
		},
		[currentRecord, editor],
	);
	useEffect(() => {
		if (!document) return;
		const update = (time: MediaTime) => {
			const seconds = mediaTimeToSeconds({ time });
			const next =
				document.clips.find(
					(clip) => clip.start <= seconds && seconds < clip.end,
				)?.id ?? null;
			setActiveId((current) => (current === next ? current : next));
		};
		update(editor.playback.getCurrentTime());
		const unsubscribeUpdate = editor.playback.onUpdate(update);
		const unsubscribeState = editor.playback.subscribe(() =>
			update(editor.playback.getCurrentTime()),
		);
		return () => {
			unsubscribeUpdate();
			unsubscribeState();
		};
	}, [document, editor]);
	useEffect(() => {
		if (!activeId || editing) return;
		scrollRef.current
			?.querySelector(`[data-caption-row="${activeId}"]`)
			?.scrollIntoView({ block: "nearest", behavior: "smooth" });
	}, [activeId, editing]);
	if (!document || !currentRecord) return null;
	return (
		<div className="flex h-full min-h-0 flex-col">
			<header className="shrink-0 border-b p-3">
				<div className="flex items-center justify-between gap-2">
					<div>
						<h2 className="text-sm font-semibold">Captions</h2>
						<p className="text-muted-foreground text-xs">
							{providerLabel || "Edit text and timing"}
						</p>
					</div>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						aria-label={searchOpen ? "Close caption search" : "Search captions"}
						onClick={() => {
							setSearchOpen((value) => !value);
							if (searchOpen) setSearch("");
						}}
					>
						{searchOpen ? <X /> : <Search />}
					</Button>
				</div>
				{searchOpen ? (
					<div className="mt-3 flex flex-col gap-2">
						<Input
							value={search}
							onChange={(event) => {
								setSearch(event.target.value);
								setResultIndex(0);
							}}
							placeholder="Search subtitles"
							aria-label="Search subtitles"
						/>
						<Input
							value={replacement}
							onChange={(event) => setReplacement(event.target.value)}
							placeholder="Replace with"
							aria-label="Replace with"
						/>
						<div className="flex flex-wrap gap-1">
							<Button
								type="button"
								variant="outline"
								disabled={!results.length}
								onClick={() => {
									const nextIndex =
										(resultIndex - 1 + results.length) % results.length;
									const clip = results[nextIndex];
									if (clip) selectClip(clip);
									setResultIndex(nextIndex);
								}}
							>
								Previous
							</Button>
							<Button
								type="button"
								variant="outline"
								disabled={!results.length}
								onClick={() => {
									const clip = results[resultIndex % results.length];
									if (clip) selectClip(clip);
									setResultIndex((value) => (value + 1) % results.length);
								}}
							>
								<Search />
								Next
							</Button>
							<Button
								type="button"
								variant="outline"
								disabled={!results.length}
								onClick={() => {
									const clip = results[resultIndex % results.length];
									if (!clip) return;
									commit(
										updateSegmentText({
											document,
											clipId: clip.id,
											text: clip.text.replaceAll(search, replacement),
										}),
									);
								}}
							>
								Replace current
							</Button>
							<Button
								type="button"
								variant="outline"
								disabled={!search}
								onClick={() =>
									commit(replaceCaptionText({ document, search, replacement }))
								}
							>
								Replace all
							</Button>
						</div>
					</div>
				) : null}
			</header>
			<ScrollArea className="min-h-0 flex-1">
				<div ref={scrollRef} className="flex flex-col">
					<Section
						collapsible
						defaultOpen
						sectionKey="caption-editor:text-timing"
						showBottomBorder
					>
						<SectionHeader className="h-8 px-3 text-xs">
							<SectionTitle className="text-xs font-semibold">
								Caption text and timing
							</SectionTitle>
						</SectionHeader>
						<SectionContent className="p-0">
							{clips.map((clip, index) => (
								<SubtitleRow
									key={clip.id}
									document={document}
									clip={clip}
									index={index}
									active={activeId === clip.id}
									selected={selectedId === clip.id}
									fps={fps}
									onSelect={() => selectClip(clip)}
									onPlay={() => {
										selectClip(clip);
										editor.playback.play();
									}}
									onChange={commit}
									onEditingChange={setEditing}
									onDelete={() =>
										commit(deleteSegment({ document, clipId: clip.id }))
									}
									onMergePrevious={() =>
										clips[index - 1] &&
										commit(
											mergeSegments({
												document,
												firstId: clips[index - 1]!.id,
												secondId: clip.id,
											}),
										)
									}
									onMergeNext={() =>
										clips[index + 1] &&
										commit(
											mergeSegments({
												document,
												firstId: clip.id,
												secondId: clips[index + 1]!.id,
											}),
										)
									}
									onAddBefore={() =>
										commit(
											addSegment({
												document,
												at: Math.max(0, clip.start - 1.5),
											}),
										)
									}
									onAddAfter={() =>
										commit(addSegment({ document, at: clip.end }))
									}
									onSplit={(characterIndex) =>
										commit(
											splitSegment({
												document,
												clipId: clip.id,
												characterIndex,
											}),
										)
									}
								/>
							))}
						</SectionContent>
					</Section>
					<Section
						collapsible
						defaultOpen={reviewWarnings.length > 0}
						sectionKey="caption-editor:review-warnings"
						showBottomBorder
					>
						<SectionHeader className="h-8 px-3 text-xs">
							<SectionTitle className="text-xs font-semibold">
								Review warnings
							</SectionTitle>
						</SectionHeader>
						<SectionContent className="px-3 pb-3 pt-1">
							{reviewWarnings.length > 0 ? (
								<div className="grid gap-1 text-xs text-amber-500">
									{reviewWarnings.map((clip) => (
										<div key={clip.id}>
											{clip.text || clip.id}: timing needs review
										</div>
									))}
								</div>
							) : (
								<p className="text-xs text-muted-foreground">
									No caption timing warnings.
								</p>
							)}
						</SectionContent>
					</Section>
					<Section
						collapsible
						defaultOpen
						sectionKey="caption-editor:additional-options"
						showBottomBorder={false}
					>
						<SectionHeader className="h-8 px-3 text-xs">
							<SectionTitle className="text-xs font-semibold">
								Additional options
							</SectionTitle>
						</SectionHeader>
						<SectionContent className="px-3 pb-3 pt-1">
							<Button
								type="button"
								variant="outline"
								onClick={() =>
									commit(
										addSegment({
											document,
											at: mediaTimeToSeconds({
												time: editor.playback.getCurrentTime(),
											}),
										}),
									)
								}
							>
								<Plus />
								Add subtitle at playhead
							</Button>
						</SectionContent>
					</Section>
				</div>
			</ScrollArea>
		</div>
	);
}
