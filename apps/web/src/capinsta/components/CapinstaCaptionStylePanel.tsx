"use client";

/* eslint-disable opencut/prefer-object-params -- Local mixed-value reader keeps JSX controls concise. */

import type { TextElement } from "@/timeline";
import { useEffect, useState, type ReactNode } from "react";
import type { CapinstaCaptionBinding } from "../captionTimelineSync";
import {
	applyCapinstaPresetToClipStyle,
	resetCapinstaClipStyleOverrides,
	updateCapinstaClipStyle,
} from "../styles/styleMigration";
import { styleToExport } from "../styles/styleToExport";
import {
	mergeCapinstaCaptionStyle,
	normalizeCapinstaCaptionStyle,
} from "../styles/styleValidation";
import type {
	CapinstaCaptionAlignment,
	CapinstaCaptionMaxLines,
	CapinstaCaptionPresetId,
	CapinstaCaptionStylePatch,
	CapinstaOutlineWeight,
} from "../styles/styleTypes";
import { useEditor } from "@/editor/use-editor";
import { UpdateCapinstaCaptionDocumentCommand } from "@/commands";
import { CapinstaPresetGrid } from "./CapinstaPresetGrid";
import { CapinstaColorControl } from "./CapinstaColorControl";
import { CapinstaSliderControl } from "./CapinstaSliderControl";
import { CapinstaToggleControl } from "./CapinstaToggleControl";
import { CapinstaAnimationGrid } from "./CapinstaAnimationGrid";
import { CAPINSTA_FONT_REGISTRY } from "@/capinsta/fonts/captionFontRegistry";
import { resolveCapinstaClipStyle } from "../styles/styleMigration";
import { mediaTimeToSeconds, type MediaTime } from "@/wasm";
import { getCapinstaActiveWordIds } from "../render/activeWordRenderer";
import type {
	CapinstaCaptionDocumentRecord,
	NeutralCaptionWord,
} from "../types";
import {
	getCaptionPresetChunkingConfig,
	isCaptionStylePresetId,
} from "../original/captionStylePresets";
import {
	applyPresetToCapinstaSelection,
	applyStylePatchToCapinstaSelection,
	getCommonStyleValue,
	resetStyleForCapinstaSelection,
	replaceDocumentTextElements,
	type CapinstaCaptionSelectionRef,
	type CapinstaBulkStyleUpdateResult,
} from "../bulkStyleSync";
import { rechunkNeutralCaptionDocumentWithConfig } from "../adapter";
import type { CaptionChunkingConfig } from "../original/types";

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="grid gap-3 border-b px-3 py-3 last:border-b-0">
			<h3 className="text-xs font-semibold">{title}</h3>
			{children}
		</section>
	);
}

function outlineWidthForWeight(weight: CapinstaOutlineWeight): number {
	if (weight === "thin") return 1;
	if (weight === "medium") return 3;
	if (weight === "thick") return 7;
	return 0;
}

function readAlignment(value: string): CapinstaCaptionAlignment {
	if (value === "left" || value === "right") return value;
	return "center";
}

function readOutlineWeight(value: string): CapinstaOutlineWeight {
	if (value === "thin" || value === "medium" || value === "thick") return value;
	return "none";
}

function readMaxLines(value: string): CapinstaCaptionMaxLines {
	if (value === "1") return 1;
	if (value === "2") return 2;
	if (value === "3") return 3;
	return "auto";
}

type CapinstaCaptionStylePanelProps =
	| {
			mode?: "single";
			binding: CapinstaCaptionBinding;
			trackId: string;
	  }
	| {
			mode: "bulk";
			selectedCapinstaClipRefs: CapinstaCaptionSelectionRef[];
			selectedCount: number;
			ignoredCount?: number;
	  };

export function CapinstaCaptionStylePanel(
	props: CapinstaCaptionStylePanelProps,
) {
	const editor = useEditor();
	useEditor(
		(instance) => instance.project.getActive()?.capinstaCaptionDocuments,
	);
	const [currentTime, setCurrentTime] = useState<MediaTime>(() =>
		editor.playback.getCurrentTime(),
	);
	const [debugOpen, setDebugOpen] = useState(false);

	const isBulkMode = props.mode === "bulk";
	const binding = isBulkMode ? null : props.binding;
	const singleTrackId = isBulkMode ? null : props.trackId;
	const selectedRefs = isBulkMode ? props.selectedCapinstaClipRefs : [];
	const style = isBulkMode
		? selectedRefs[0]?.style
		: resolveCapinstaClipStyle({
				document: props.binding.record.document,
				clip: props.binding.clip,
			});

	const debugEnabled = process.env.NEXT_PUBLIC_CAPINSTA_DEBUG === "true";
	const timeSeconds = mediaTimeToSeconds({ time: currentTime });
	const clipWords: NeutralCaptionWord[] = (
		binding
			? binding.clip.wordIds.map((wordId) =>
					binding.record.document.words.find((word) => word.id === wordId),
				)
			: []
	).filter((word): word is NeutralCaptionWord => word !== undefined);
	const activeWordIds = binding
		? getCapinstaActiveWordIds({
				clip: binding.clip,
				words: clipWords,
				timeSeconds,
			})
		: [];
	const activeWord = clipWords.find((word) => activeWordIds.includes(word.id));

	useEffect(() => {
		const update = (time: MediaTime) => setCurrentTime(time);
		const unsubscribeUpdate = editor.playback.onUpdate(update);
		const unsubscribeSeek = editor.playback.onSeek(update);
		const unsubscribePlayback = editor.playback.subscribe(() =>
			setCurrentTime(editor.playback.getCurrentTime()),
		);
		return () => {
			unsubscribeUpdate();
			unsubscribeSeek();
			unsubscribePlayback();
		};
	}, [editor.playback]);

	if (!style) return null;

	function replaceRecord(nextRecord: CapinstaCaptionDocumentRecord) {
		if (!binding || !singleTrackId) return;
		editor.command.execute({
			command: new UpdateCapinstaCaptionDocumentCommand(nextRecord),
		});
	}

	function updateTimelineTextElement(patch: CapinstaCaptionStylePatch) {
		if (!binding || !singleTrackId) return;
		const nextStyle = normalizeCapinstaCaptionStyle(
			mergeCapinstaCaptionStyle(style, patch),
		);
		const exportStyle = styleToExport({
			style: nextStyle,
			timingNeedsReview: binding.clip.timingNeedsReview,
		});
		const nextParams: TextElement["params"] = {
			...binding.element.params,
			...exportStyle.textParams,
		};
		editor.timeline.updateElements({
			updates: [
				{
					trackId: singleTrackId,
					elementId: binding.element.id,
					patch: {
						params: nextParams,
					},
				},
			],
			pushHistory: false,
		});
	}

	function applyBulkUpdate(result: CapinstaBulkStyleUpdateResult) {
		const currentRecords =
			editor.project.getActive()?.capinstaCaptionDocuments ?? [];
		const changedRecords = result.records.filter((record) => {
			const currentRecord = currentRecords.find(
				(candidate) => candidate.document.id === record.document.id,
			);
			return currentRecord && currentRecord.document !== record.document;
		});
		const commandOwnsRecordUpdate = changedRecords.length === 1;
		if (commandOwnsRecordUpdate) {
			editor.command.execute({
				command: new UpdateCapinstaCaptionDocumentCommand(changedRecords[0]!),
			});
		} else {
			editor.project.replaceCapinstaCaptionDocuments({
				records: result.records,
			});
		}
		if (result.tracks) {
			if (!commandOwnsRecordUpdate) {
				editor.timeline.updateTracks(result.tracks);
			}
			return;
		}
		editor.timeline.updateElements({
			updates: result.timelineUpdates,
			pushHistory: false,
		});
	}

	function updateStyle(patch: CapinstaCaptionStylePatch) {
		if (isBulkMode) {
			applyBulkUpdate(
				applyStylePatchToCapinstaSelection({
					records: editor.project.getActive()?.capinstaCaptionDocuments ?? [],
					tracks: editor.scenes.getActiveScene().tracks,
					selectedRefs,
					stylePatch: patch,
				}),
			);
			return;
		}
		if (!binding || !singleTrackId) return;
		const nextRecord = updateCapinstaClipStyle({
			record: binding.record,
			clipId: binding.clip.id,
			patch,
		});
		replaceRecord(nextRecord);
		updateTimelineTextElement(patch);
	}

	function updateChunkingConfig(patch: Partial<CaptionChunkingConfig>) {
		if (isBulkMode) {
			const activeDocs = new Map<string, CapinstaCaptionSelectionRef[]>();
			for (const ref of selectedRefs) {
				const refs = activeDocs.get(ref.documentId) ?? [];
				refs.push(ref);
				activeDocs.set(ref.documentId, refs);
			}

			let nextRecords =
				editor.project.getActive()?.capinstaCaptionDocuments ?? [];
			let nextTracks = editor.scenes.getActiveScene().tracks;

			for (const [docId, refs] of activeDocs.entries()) {
				const record = nextRecords.find((r) => r.document.id === docId);
				if (!record) continue;

				const defaultChunking = {
					...getCaptionPresetChunkingConfig(
						isCaptionStylePresetId(style.presetId)
							? style.presetId
							: "modern_minimalist_lockup",
					),
					...style.chunking,
				};
				const currentChunking = {
					...defaultChunking,
					...(record.document.style?.chunking ?? {}),
					...patch,
				};

				const updatedDoc = rechunkNeutralCaptionDocumentWithConfig({
					document: record.document,
					chunkingConfig: currentChunking,
				});

				const nextRecord = { ...record, document: updatedDoc };
				nextRecords = nextRecords.map((r) =>
					r.document.id === docId ? nextRecord : r,
				);

				nextTracks = replaceDocumentTextElements({
					tracks: nextTracks,
					record: nextRecord,
					templateRefs: refs,
				});
			}

			editor.project.replaceCapinstaCaptionDocuments({ records: nextRecords });
			editor.timeline.updateTracks(nextTracks);
			return;
		}

		if (!binding || !singleTrackId) return;

		const defaultChunking = {
			...getCaptionPresetChunkingConfig(
				isCaptionStylePresetId(style.presetId)
					? style.presetId
					: "modern_minimalist_lockup",
			),
			...style.chunking,
		};
		const currentChunking = {
			...defaultChunking,
			...(style.chunking ?? {}),
			...patch,
		};

		const updatedDocument = rechunkNeutralCaptionDocumentWithConfig({
			document: binding.record.document,
			chunkingConfig: currentChunking,
		});

		const nextRecord = { ...binding.record, document: updatedDocument };
		replaceRecord(nextRecord);

		const currentTracks = editor.scenes.getActiveScene().tracks;
		const updatedTracks = replaceDocumentTextElements({
			tracks: currentTracks,
			record: nextRecord,
			templateRefs: [
				{
					elementId: binding.element.id,
					trackId: singleTrackId,
					documentId: binding.record.document.id,
					clipId: binding.clip.id,
					record: binding.record,
					clip: binding.clip,
					element: binding.element,
					style,
				},
			],
		});
		editor.timeline.updateTracks(updatedTracks);
	}

	function applyPreset(presetId: CapinstaCaptionPresetId) {
		if (isBulkMode) {
			applyBulkUpdate(
				applyPresetToCapinstaSelection({
					records: editor.project.getActive()?.capinstaCaptionDocuments ?? [],
					tracks: editor.scenes.getActiveScene().tracks,
					selectedRefs,
					presetId,
				}),
			);
			return;
		}
		if (!binding || !singleTrackId) return;
		const nextRecord = applyCapinstaPresetToClipStyle({
			record: binding.record,
			clipId: binding.clip.id,
			presetId,
		});
		const nextClip = nextRecord.document.clips.find(
			(clip) => clip.id === binding.clip.id,
		);
		if (nextClip?.style) {
			const exportStyle = styleToExport({
				style: nextClip.style,
				timingNeedsReview: nextClip.timingNeedsReview,
			});
			const nextParams: TextElement["params"] = {
				...binding.element.params,
				...exportStyle.textParams,
			};
			editor.timeline.updateElements({
				updates: [
					{
						trackId: singleTrackId,
						elementId: binding.element.id,
						patch: {
							params: nextParams,
						},
					},
				],
				pushHistory: false,
			});
		}
		replaceRecord(nextRecord);
	}

	function resetStyle() {
		if (isBulkMode) {
			applyBulkUpdate(
				resetStyleForCapinstaSelection({
					records: editor.project.getActive()?.capinstaCaptionDocuments ?? [],
					tracks: editor.scenes.getActiveScene().tracks,
					selectedRefs,
				}),
			);
			return;
		}
		if (!binding) return;
		replaceRecord(
			resetCapinstaClipStyleOverrides({
				record: binding.record,
				clipId: binding.clip.id,
			}),
		);
	}

	function commonValue<T>(path: string, fallback: T): T {
		if (!isBulkMode) return fallback;
		return getCommonStyleValue<T>(selectedRefs, path) ?? fallback;
	}

	function hasMixedValue(path: string): boolean {
		return isBulkMode && getCommonStyleValue(selectedRefs, path) === undefined;
	}

	const activePresetId = isBulkMode
		? (getCommonStyleValue<CapinstaCaptionPresetId>(selectedRefs, "presetId") ??
			"")
		: style.presetId;

	return (
		<div className="grid">
			{isBulkMode ? (
				<div className="grid gap-1 border-b px-3 py-3 text-xs">
					<div className="font-semibold">Editing: All Captions</div>
					<div className="text-muted-foreground">
						{props.selectedCount} Capinsta captions selected
					</div>
					{props.ignoredCount ? (
						<div className="text-muted-foreground">
							{props.ignoredCount} non-Capinsta elements ignored
						</div>
					) : null}
					<div className="text-muted-foreground">
						Changes apply to all selected Capinsta captions.
					</div>
				</div>
			) : binding ? (
				<div className="grid gap-1 border-b px-3 py-3 text-xs">
					<div className="font-semibold">
						Editing: {binding.clip.text ? `“${binding.clip.text}”` : binding.clip.id}
					</div>
					<div className="text-muted-foreground">
						Changes apply only to this caption.
					</div>
				</div>
			) : null}
			<Section title="Capinsta Presets">
				<CapinstaPresetGrid
					activePresetId={activePresetId}
					onSelectPreset={applyPreset}
				/>
				<button
					type="button"
					onClick={resetStyle}
					className="rounded-sm border px-2 py-1 text-xs hover:bg-accent"
				>
					Reset selected preset
				</button>
			</Section>
			<Section title="Text">
				<label className="grid gap-1 text-xs">
					<span className="text-muted-foreground">Font</span>
					<select
						value={commonValue("text.fontFamily", style.text.fontFamily)}
						onChange={(event) =>
							updateStyle({ text: { fontFamily: event.currentTarget.value } })
						}
						className="bg-background rounded-sm border px-2 py-1"
					>
						{hasMixedValue("text.fontFamily") ? (
							<option value="">Mixed</option>
						) : null}
						{CAPINSTA_FONT_REGISTRY.map((font) => (
							<option key={font.id} value={font.cssFamily}>
								{font.label}
							</option>
						))}
					</select>
				</label>
				<label className="grid gap-1 text-xs">
					<span className="text-muted-foreground">Weight</span>
					<select
						value={commonValue("text.fontWeight", style.text.fontWeight)}
						onChange={(event) =>
							updateStyle({
								text: {
									fontWeight:
										event.currentTarget.value === "normal" ? "normal" : "bold",
								},
							})
						}
						className="bg-background rounded-sm border px-2 py-1"
					>
						{hasMixedValue("text.fontWeight") ? (
							<option value="">Mixed</option>
						) : null}
						<option value="normal">Normal</option>
						<option value="bold">Bold</option>
					</select>
				</label>
				<label className="grid gap-1 text-xs">
					<span className="text-muted-foreground">Alignment</span>
					<select
						value={commonValue("text.alignment", style.text.alignment)}
						onChange={(event) =>
							updateStyle({
								text: {
									alignment: readAlignment(event.currentTarget.value),
								},
							})
						}
						className="bg-background rounded-sm border px-2 py-1"
					>
						{hasMixedValue("text.alignment") ? (
							<option value="">Mixed</option>
						) : null}
						<option value="left">Left</option>
						<option value="center">Center</option>
						<option value="right">Right</option>
					</select>
				</label>
				<CapinstaSliderControl
					label="Font size"
					value={commonValue("text.fontSize", style.text.fontSize)}
					mixed={hasMixedValue("text.fontSize")}
					min={12}
					max={160}
					onChange={(fontSize) => updateStyle({ text: { fontSize } })}
				/>
				<CapinstaSliderControl
					label="Line height"
					value={commonValue("text.lineHeight", style.text.lineHeight)}
					mixed={hasMixedValue("text.lineHeight")}
					min={0.8}
					max={1.8}
					step={0.01}
					onChange={(lineHeight) => updateStyle({ text: { lineHeight } })}
				/>
				<label className="grid gap-1 text-xs">
					<span className="text-muted-foreground">Max lines</span>
					<select
						value={String(commonValue("text.maxLines", style.text.maxLines))}
						onChange={(event) => {
							const maxLines = readMaxLines(event.currentTarget.value);
							updateStyle({
								text: { maxLines },
								chunking: { maxLines },
							});
						}}
						className="bg-background rounded-sm border px-2 py-1"
					>
						{hasMixedValue("text.maxLines") ? (
							<option value="">Mixed</option>
						) : null}
						<option value="auto">Auto</option>
						<option value="1">1</option>
						<option value="2">2</option>
						<option value="3">3</option>
					</select>
				</label>
				<CapinstaColorControl
					label="Text color"
					value={commonValue("text.color", style.text.color)}
					mixed={hasMixedValue("text.color")}
					onChange={(color) => updateStyle({ text: { color } })}
				/>
				<CapinstaSliderControl
					label="Text opacity"
					value={commonValue("text.opacity", style.text.opacity)}
					mixed={hasMixedValue("text.opacity")}
					min={0}
					max={1}
					step={0.01}
					onChange={(opacity) => updateStyle({ text: { opacity } })}
				/>
				<label className="grid gap-1 text-xs">
					<span className="text-muted-foreground">Text transform</span>
					<select
						value={commonValue("text.textTransform", style.text.textTransform)}
						onChange={(event) =>
							updateStyle({
								text: {
									textTransform:
										event.currentTarget.value === "uppercase"
											? "uppercase"
											: "none",
								},
							})
						}
						className="bg-background rounded-sm border px-2 py-1"
					>
						{hasMixedValue("text.textTransform") ? (
							<option value="">Mixed</option>
						) : null}
						<option value="none">None</option>
						<option value="uppercase">Uppercase</option>
					</select>
				</label>
				<CapinstaSliderControl
					label="Letter spacing"
					value={commonValue("text.letterSpacing", style.text.letterSpacing)}
					mixed={hasMixedValue("text.letterSpacing")}
					min={-2}
					max={8}
					step={0.1}
					onChange={(letterSpacing) => updateStyle({ text: { letterSpacing } })}
				/>
				<CapinstaSliderControl
					label="Word spacing"
					value={commonValue("text.wordSpacing", style.text.wordSpacing)}
					mixed={hasMixedValue("text.wordSpacing")}
					min={0}
					max={40}
					step={0.5}
					onChange={(wordSpacing) => updateStyle({ text: { wordSpacing } })}
				/>
				<CapinstaColorControl
					label="Active word"
					value={commonValue("activeWord.color", style.activeWord.color)}
					mixed={hasMixedValue("activeWord.color")}
					onChange={(color) => updateStyle({ activeWord: { color } })}
				/>
			</Section>
			<Section title="Background">
				<CapinstaToggleControl
					label="Enabled"
					checked={commonValue("background.enabled", style.background.enabled)}
					mixed={hasMixedValue("background.enabled")}
					onChange={(enabled) => updateStyle({ background: { enabled } })}
				/>
				<CapinstaColorControl
					label="Color"
					value={commonValue("background.color", style.background.color)}
					mixed={hasMixedValue("background.color")}
					onChange={(color) => updateStyle({ background: { color } })}
				/>
				<button
					type="button"
					onClick={() =>
						updateStyle({ background: { enabled: false, opacity: 0 } })
					}
					className="rounded-sm border px-2 py-1 text-xs hover:bg-accent"
				>
					Transparent background
				</button>
				<label className="grid gap-1 text-xs">
					<span className="text-muted-foreground">Background fit</span>
					<select
						value={commonValue("background.fit", style.background.fit)}
						onChange={(event) =>
							updateStyle({
								background: {
									fit: event.currentTarget.value === "fill" ? "fill" : "wrap",
								},
							})
						}
						className="bg-background rounded-sm border px-2 py-1"
					>
						{hasMixedValue("background.fit") ? (
							<option value="">Mixed</option>
						) : null}
						<option value="wrap">Wrap</option>
						<option value="fill">Fill</option>
					</select>
				</label>
				<CapinstaSliderControl
					label="Opacity"
					value={commonValue("background.opacity", style.background.opacity)}
					mixed={hasMixedValue("background.opacity")}
					min={0}
					max={1}
					step={0.01}
					onChange={(opacity) => updateStyle({ background: { opacity } })}
				/>
				<CapinstaSliderControl
					label="Radius"
					value={commonValue(
						"background.cornerRadius",
						style.background.cornerRadius,
					)}
					mixed={hasMixedValue("background.cornerRadius")}
					min={0}
					max={60}
					onChange={(cornerRadius) =>
						updateStyle({ background: { cornerRadius } })
					}
				/>
				<CapinstaSliderControl
					label="Padding X"
					value={commonValue("background.paddingX", style.background.paddingX)}
					mixed={hasMixedValue("background.paddingX")}
					min={0}
					max={80}
					onChange={(paddingX) => updateStyle({ background: { paddingX } })}
				/>
				<CapinstaSliderControl
					label="Padding Y"
					value={commonValue("background.paddingY", style.background.paddingY)}
					mixed={hasMixedValue("background.paddingY")}
					min={0}
					max={80}
					onChange={(paddingY) => updateStyle({ background: { paddingY } })}
				/>
			</Section>
			<Section title="Border">
				<CapinstaToggleControl
					label="Background border"
					checked={commonValue(
						"background.borderEnabled",
						style.background.borderEnabled,
					)}
					mixed={hasMixedValue("background.borderEnabled")}
					onChange={(borderEnabled) =>
						updateStyle({
							background: {
								borderEnabled,
								borderWidth: borderEnabled
									? Math.max(1, style.background.borderWidth)
									: 0,
							},
						})
					}
				/>
				<CapinstaColorControl
					label="Border color"
					value={commonValue(
						"background.borderColor",
						style.background.borderColor,
					)}
					mixed={hasMixedValue("background.borderColor")}
					onChange={(borderColor) =>
						updateStyle({ background: { borderColor } })
					}
				/>
				<CapinstaSliderControl
					label="Border width"
					value={commonValue(
						"background.borderWidth",
						style.background.borderWidth,
					)}
					mixed={hasMixedValue("background.borderWidth")}
					min={0}
					max={8}
					onChange={(borderWidth) =>
						updateStyle({
							background: {
								borderWidth,
								borderEnabled: borderWidth > 0,
							},
						})
					}
				/>
				<label className="grid gap-1 text-xs">
					<span className="text-muted-foreground">Text outline</span>
					<select
						value={commonValue("outline.weight", style.outline.weight)}
						onChange={(event) => {
							const weight = readOutlineWeight(event.currentTarget.value);
							updateStyle({
								outline: {
									weight,
									width: outlineWidthForWeight(weight),
								},
							});
						}}
						className="bg-background rounded-sm border px-2 py-1"
					>
						{hasMixedValue("outline.weight") ? (
							<option value="">Mixed</option>
						) : null}
						<option value="none">None</option>
						<option value="thin">Thin</option>
						<option value="medium">Medium</option>
						<option value="thick">Thick</option>
					</select>
				</label>
				<CapinstaColorControl
					label="Outline color"
					value={commonValue("outline.color", style.outline.color)}
					mixed={hasMixedValue("outline.color")}
					onChange={(color) => updateStyle({ outline: { color } })}
				/>
			</Section>
			<Section title="Shadow">
				<CapinstaToggleControl
					label="Text shadow"
					checked={commonValue("shadow.enabled", style.shadow.enabled)}
					mixed={hasMixedValue("shadow.enabled")}
					onChange={(enabled) => updateStyle({ shadow: { enabled } })}
				/>
				<CapinstaColorControl
					label="Shadow color"
					value={commonValue("shadow.color", style.shadow.color)}
					mixed={hasMixedValue("shadow.color")}
					onChange={(color) => updateStyle({ shadow: { color } })}
				/>
				<CapinstaSliderControl
					label="Shadow opacity"
					value={commonValue("shadow.opacity", style.shadow.opacity)}
					mixed={hasMixedValue("shadow.opacity")}
					min={0}
					max={1}
					step={0.01}
					onChange={(opacity) => updateStyle({ shadow: { opacity } })}
				/>
				<CapinstaSliderControl
					label="Shadow blur"
					value={commonValue("shadow.blur", style.shadow.blur)}
					mixed={hasMixedValue("shadow.blur")}
					min={0}
					max={60}
					onChange={(blur) => updateStyle({ shadow: { blur } })}
				/>
				<CapinstaSliderControl
					label="Shadow distance"
					value={commonValue("shadow.distance", style.shadow.distance)}
					mixed={hasMixedValue("shadow.distance")}
					min={0}
					max={36}
					onChange={(distance) => updateStyle({ shadow: { distance } })}
				/>
				<CapinstaSliderControl
					label="Shadow angle"
					value={commonValue("shadow.angle", style.shadow.angle)}
					mixed={hasMixedValue("shadow.angle")}
					min={0}
					max={360}
					unit="deg"
					onChange={(angle) => updateStyle({ shadow: { angle } })}
				/>
				<CapinstaToggleControl
					label="Background shadow"
					checked={commonValue(
						"background.shadowEnabled",
						style.background.shadowEnabled,
					)}
					mixed={hasMixedValue("background.shadowEnabled")}
					onChange={(shadowEnabled) =>
						updateStyle({ background: { shadowEnabled } })
					}
				/>
				<CapinstaColorControl
					label="Background shadow color"
					value={commonValue(
						"background.shadowColor",
						style.background.shadowColor,
					)}
					mixed={hasMixedValue("background.shadowColor")}
					onChange={(shadowColor) =>
						updateStyle({ background: { shadowColor } })
					}
				/>
				<CapinstaSliderControl
					label="Background opacity"
					value={commonValue(
						"background.shadowOpacity",
						style.background.shadowOpacity,
					)}
					mixed={hasMixedValue("background.shadowOpacity")}
					min={0}
					max={1}
					step={0.01}
					onChange={(shadowOpacity) =>
						updateStyle({ background: { shadowOpacity } })
					}
				/>
				<CapinstaSliderControl
					label="Background blur"
					value={commonValue(
						"background.shadowBlur",
						style.background.shadowBlur,
					)}
					mixed={hasMixedValue("background.shadowBlur")}
					min={0}
					max={60}
					onChange={(shadowBlur) => updateStyle({ background: { shadowBlur } })}
				/>
				<CapinstaSliderControl
					label="Background distance"
					value={commonValue(
						"background.shadowDistance",
						style.background.shadowDistance,
					)}
					mixed={hasMixedValue("background.shadowDistance")}
					min={0}
					max={36}
					onChange={(shadowDistance) =>
						updateStyle({ background: { shadowDistance } })
					}
				/>
				<CapinstaSliderControl
					label="Background angle"
					value={commonValue(
						"background.shadowAngle",
						style.background.shadowAngle,
					)}
					mixed={hasMixedValue("background.shadowAngle")}
					min={0}
					max={360}
					unit="deg"
					onChange={(shadowAngle) =>
						updateStyle({ background: { shadowAngle } })
					}
				/>
			</Section>
			<Section title="Word Effects & Transitions">
				<CapinstaAnimationGrid
					wordEffect={commonValue(
						"animation.wordEffect",
						style.animation.wordEffect,
					)}
					transition={commonValue(
						"animation.transition",
						style.animation.transition,
					)}
					activeWordColor={commonValue(
						"activeWord.color",
						style.activeWord.color,
					)}
					onPatch={updateStyle}
				/>
				<CapinstaSliderControl
					label="Strength"
					value={commonValue("animation.strength", style.animation.strength)}
					mixed={hasMixedValue("animation.strength")}
					min={0}
					max={1.4}
					step={0.01}
					onChange={(strength) => updateStyle({ animation: { strength } })}
				/>
				<CapinstaSliderControl
					label="Speed"
					value={commonValue("animation.speed", style.animation.speed)}
					mixed={hasMixedValue("animation.speed")}
					min={0.4}
					max={2}
					step={0.01}
					onChange={(speed) => updateStyle({ animation: { speed } })}
				/>
				<CapinstaSliderControl
					label="Smoothness"
					value={commonValue(
						"animation.smoothness",
						style.animation.smoothness,
					)}
					mixed={hasMixedValue("animation.smoothness")}
					min={0}
					max={1}
					step={0.01}
					onChange={(smoothness) => updateStyle({ animation: { smoothness } })}
				/>
			</Section>
			<Section title="Layout">
				<CapinstaSliderControl
					label="X"
					value={commonValue("layout.positionX", style.layout.positionX)}
					mixed={hasMixedValue("layout.positionX")}
					min={0}
					max={100}
					unit="%"
					onChange={(positionX) => updateStyle({ layout: { positionX } })}
				/>
				<CapinstaSliderControl
					label="Y"
					value={commonValue("layout.positionY", style.layout.positionY)}
					mixed={hasMixedValue("layout.positionY")}
					min={0}
					max={100}
					unit="%"
					onChange={(positionY) => updateStyle({ layout: { positionY } })}
				/>
				<CapinstaSliderControl
					label="Max width"
					value={commonValue("layout.maxWidth", style.layout.maxWidth)}
					mixed={hasMixedValue("layout.maxWidth")}
					min={20}
					max={100}
					unit="%"
					onChange={(maxWidth) => updateStyle({ layout: { maxWidth } })}
				/>
				<CapinstaSliderControl
					label="Scale"
					value={commonValue("layout.scale", style.layout.scale)}
					mixed={hasMixedValue("layout.scale")}
					min={0.5}
					max={2}
					step={0.01}
					onChange={(scale) => updateStyle({ layout: { scale } })}
				/>
				<CapinstaSliderControl
					label="Layer opacity"
					value={commonValue("layout.opacity", style.layout.opacity)}
					mixed={hasMixedValue("layout.opacity")}
					min={0}
					max={1}
					step={0.01}
					onChange={(opacity) => updateStyle({ layout: { opacity } })}
				/>
				<CapinstaToggleControl
					label="Asymmetric scale"
					checked={commonValue(
						"layout.asymmetricScaleEnabled",
						style.layout.asymmetricScaleEnabled,
					)}
					mixed={hasMixedValue("layout.asymmetricScaleEnabled")}
					onChange={(asymmetricScaleEnabled) =>
						updateStyle({ layout: { asymmetricScaleEnabled } })
					}
				/>
				<CapinstaSliderControl
					label="Asymmetric strength"
					value={commonValue(
						"layout.asymmetricScaleStrength",
						style.layout.asymmetricScaleStrength,
					)}
					mixed={hasMixedValue("layout.asymmetricScaleStrength")}
					min={0}
					max={0.5}
					step={0.01}
					onChange={(asymmetricScaleStrength) =>
						updateStyle({ layout: { asymmetricScaleStrength } })
					}
				/>
				<CapinstaToggleControl
					label="Safe area"
					checked={commonValue(
						"layout.safeAreaEnabled",
						style.layout.safeAreaEnabled,
					)}
					mixed={hasMixedValue("layout.safeAreaEnabled")}
					onChange={(safeAreaEnabled) =>
						updateStyle({ layout: { safeAreaEnabled } })
					}
				/>
			</Section>
			<Section title="Subtitle Splits">
				<CapinstaSliderControl
					label="Characters per subtitle"
					scrubbable={false}
					value={commonValue(
						"chunking.maxCharsPerCaption",
						style.chunking?.maxCharsPerCaption ?? 34,
					)}
					mixed={hasMixedValue("chunking.maxCharsPerCaption")}
					min={10}
					max={100}
					step={1}
					onChange={(maxCharsPerCaption) =>
						updateChunkingConfig({ maxCharsPerCaption })
					}
				/>
				<CapinstaSliderControl
					label="Words per subtitle"
					scrubbable={false}
					value={commonValue(
						"chunking.maxWordsPerCaption",
						style.chunking?.maxWordsPerCaption ?? 5,
					)}
					mixed={hasMixedValue("chunking.maxWordsPerCaption")}
					min={1}
					max={20}
					step={1}
					onChange={(maxWordsPerCaption) =>
						updateChunkingConfig({
							maxWordsPerCaption,
							targetWordsPerCaption: Math.max(1, maxWordsPerCaption - 1),
						})
					}
				/>
			</Section>
			{debugEnabled && binding ? (
				<Section title="Capinsta Debug">
					<button
						type="button"
						onClick={() => setDebugOpen((open) => !open)}
						className="rounded-sm border px-2 py-1 text-left text-xs hover:bg-accent"
					>
						{debugOpen ? "Hide render diagnostics" : "Show render diagnostics"}
					</button>
					{debugOpen ? (
						<div className="grid gap-1 rounded-sm border bg-muted/30 p-2 font-mono text-[10px] leading-tight text-muted-foreground">
							<div>caption={binding.clip.id}</div>
							<div>activeWord={activeWord?.id ?? "none"}</div>
							<div>time={timeSeconds.toFixed(3)}</div>
							<div>
								clip={binding.clip.start.toFixed(3)}-
								{binding.clip.end.toFixed(3)}
							</div>
							<div>
								word=
								{activeWord
									? `${activeWord.start.toFixed(3)}-${activeWord.end.toFixed(3)}`
									: "none"}
							</div>
							<div>
								timingNeedsReview={String(binding.clip.timingNeedsReview)}
							</div>
							<div>preset={style.presetId}</div>
							<div>styleHash={JSON.stringify(style).length}</div>
						</div>
					) : null}
				</Section>
			) : null}
		</div>
	);
}
