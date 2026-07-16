"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import {
	ArrowDown01Icon,
	ArrowUp01Icon,
	Delete02Icon,
	ImageAdd02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/editor/use-editor";
import {
	getTemplateDefinition,
	moveTemplateSlot,
	moveTemplateSlotById,
	normalizeTemplateSlotOrder,
	templateDefinitions,
} from "@/templates";
import {
	buildReplaceTemplatePatch,
	buildResetTemplatePatch,
	emptySlotBindings,
} from "@/templates/instance-actions";
import type {
	MotionTemplateElement,
	MotionTemplateSlotBinding,
} from "@/timeline";

export function TemplateInspector({
	element,
	trackId,
}: {
	element: MotionTemplateElement;
	trackId: string;
}) {
	const editor = useEditor();
	const assets = useEditor((instance) => instance.media.getAssets());
	const definition = getTemplateDefinition({ templateId: element.templateId });
	const [expandedSlotId, setExpandedSlotId] = useState<string | null>(null);
	const [draggingSlotId, setDraggingSlotId] = useState<string | null>(null);
	const [dragOverSlotId, setDragOverSlotId] = useState<string | null>(null);
	const slotOrder = normalizeTemplateSlotOrder({
		definition,
		slotOrder: element.slotOrder,
	});
	const slotsById = new Map(
		definition.mediaSlots.map((slot) => [slot.id, slot]),
	);
	const orderedSlots = slotOrder.flatMap((slotId) => {
		const slot = slotsById.get(slotId);
		return slot ? [slot] : [];
	});

	const update = ({ patch }: { patch: Partial<MotionTemplateElement> }) =>
		editor.timeline.updateElements({
			updates: [{ trackId, elementId: element.id, patch }],
		});
	const updateParam = ({ key, value }: { key: string; value: unknown }): void =>
		update({
			patch: { templateParams: { ...element.templateParams, [key]: value } },
		});
	const updateSlot = ({
		slotId,
		binding,
	}: {
		slotId: string;
		binding: MotionTemplateSlotBinding | null;
	}): void =>
		update({
			patch: { slotBindings: { ...element.slotBindings, [slotId]: binding } },
		});

	const imageOrVideoAssets = useMemo(
		() =>
			assets.filter(
				(asset) => asset.type === "image" || asset.type === "video",
			),
		[assets],
	);

	const reset = ({ includeMedia }: { includeMedia: boolean }) =>
		update({
			patch: buildResetTemplatePatch({ definition, includeMedia }),
		});

	const replace = ({ templateId }: { templateId: string }) => {
		const patch = buildReplaceTemplatePatch({
			element,
			sourceDefinition: definition,
			destinationTemplateId: templateId,
		});
		if (!patch) return;
		update({
			patch,
		});
	};

	return (
		<div className="space-y-4 pb-4">
			<div className="rounded-md border border-border bg-card p-3">
				<div className="text-sm font-semibold">{definition.name}</div>
				<p className="mt-1 text-xs text-muted-foreground">
					{definition.description}
				</p>
			</div>
			<Section title="Frame">
				<ParameterControl
					parameter={
						definition.parameters.find((item) => item.id === "frameRatio")!
					}
					value={element.templateParams.frameRatio ?? "project"}
					onChange={(value) => updateParam({ key: "frameRatio", value })}
				/>
			</Section>
			<Section title={`Media · ${definition.mediaSlots.length} slots`}>
				<div className="space-y-2">
					{orderedSlots.map((slot, index) => {
						const binding = element.slotBindings[slot.id];
						const asset = binding
							? assets.find((item) => item.id === binding.mediaId)
							: undefined;
						const thumbnailUrl = asset?.thumbnailUrl ?? asset?.url;
						return (
							<div key={slot.id}>
								<div
									data-testid="template-media-slot"
									data-slot-id={slot.id}
									className={`flex items-center gap-2 rounded-md border p-2 ${
										dragOverSlotId === slot.id
											? "border-primary bg-primary/10"
											: "border-border"
									} ${draggingSlotId === slot.id ? "opacity-60" : ""}`}
									onDragOver={(event) => {
										if (draggingSlotId) {
											event.preventDefault();
											setDragOverSlotId(slot.id);
											return;
										}
										if (
											editor.timeline.dragSource.getActive()?.type === "media"
										) {
											event.preventDefault();
										}
									}}
									onDrop={(event) => {
										event.preventDefault();
										if (draggingSlotId) {
											const sourceIndex = slotOrder.indexOf(draggingSlotId);
											const destinationIndex = slotOrder.indexOf(slot.id);
											setDraggingSlotId(null);
											setDragOverSlotId(null);
											if (
												sourceIndex >= 0 &&
												destinationIndex >= 0 &&
												sourceIndex !== destinationIndex
											) {
												update({
													patch: {
														slotOrder: moveTemplateSlot({
															slotOrder,
															sourceIndex,
															destinationIndex,
														}),
													},
												});
											}
											return;
										}
										const drag = editor.timeline.dragSource.getActive();
										if (drag?.type === "media" && drag.mediaType !== "audio") {
											updateSlot({
												slotId: slot.id,
												binding: {
													mediaId: drag.id,
													fit: binding?.fit ?? "cover",
													crop: binding?.crop ?? { x: 0, y: 0, scale: 1 },
													playbackMode: binding?.playbackMode ?? "loop",
												},
											});
										}
									}}
									onDragLeave={() => {
										if (dragOverSlotId === slot.id) setDragOverSlotId(null);
									}}
								>
									{definition.allowSlotReorder && (
										<Button
											data-testid="template-slot-drag-handle"
											data-slot-id={slot.id}
											size="icon"
											variant="ghost"
											draggable
											aria-label={`Drag ${slot.label} to reorder`}
											className="cursor-grab active:cursor-grabbing"
											onDragStart={(event) => {
												setDraggingSlotId(slot.id);
												setDragOverSlotId(slot.id);
												event.dataTransfer.effectAllowed = "move";
												event.dataTransfer.setData(
													"text/plain",
													`motion-template-slot:${slot.id}`,
												);
											}}
											onDragEnd={() => {
												setDraggingSlotId(null);
												setDragOverSlotId(null);
											}}
											onKeyDown={(event) => {
												if (event.key === "Escape") {
													setDraggingSlotId(null);
													setDragOverSlotId(null);
												}
											}}
										>
											<span aria-hidden="true">::</span>
										</Button>
									)}
									<div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted">
										{thumbnailUrl ? (
											<Image
												src={thumbnailUrl}
												alt=""
												className="size-full object-cover"
												width={40}
												height={40}
												unoptimized
											/>
										) : (
											<HugeiconsIcon
												icon={ImageAdd02Icon}
												className="text-muted-foreground"
											/>
										)}
									</div>
									<label className="min-w-0 flex-1 text-xs">
										<span className="mb-1 block font-medium">{slot.label}</span>
										<select
											className="h-7 w-full rounded border border-border bg-background px-1 text-xs"
											value={binding?.mediaId ?? ""}
											onChange={(event) =>
												updateSlot({
													slotId: slot.id,
													binding: event.target.value
														? {
																mediaId: event.target.value,
																fit: binding?.fit ?? "cover",
																crop: binding?.crop ?? { x: 0, y: 0, scale: 1 },
																playbackMode: binding?.playbackMode ?? "loop",
															}
														: null,
												})
											}
										>
											<option value="">Choose media</option>
											{imageOrVideoAssets.map((media) => (
												<option key={media.id} value={media.id}>
													{media.name}
												</option>
											))}
										</select>
									</label>
									{definition.allowSlotReorder && (
										<div className="flex gap-1">
											<Button
												size="icon"
												variant="ghost"
												aria-label={`Move ${slot.label} up`}
												disabled={index === 0}
												onClick={() =>
													update({
														patch: {
															slotOrder: moveTemplateSlotById({
																definition,
																slotOrder,
																slotId: slot.id,
																direction: "up",
															}),
														},
													})
												}
											>
												<HugeiconsIcon icon={ArrowUp01Icon} />
											</Button>
											<Button
												size="icon"
												variant="ghost"
												aria-label={`Move ${slot.label} down`}
												disabled={index === orderedSlots.length - 1}
												onClick={() =>
													update({
														patch: {
															slotOrder: moveTemplateSlotById({
																definition,
																slotOrder,
																slotId: slot.id,
																direction: "down",
															}),
														},
													})
												}
											>
												<HugeiconsIcon icon={ArrowDown01Icon} />
											</Button>
										</div>
									)}
									{binding && (
										<Button
											size="icon"
											variant="ghost"
											aria-label={`Remove ${slot.label}`}
											onClick={() =>
												updateSlot({ slotId: slot.id, binding: null })
											}
										>
											<HugeiconsIcon icon={Delete02Icon} />
										</Button>
									)}
									{binding && (
										<Button
											size="sm"
											variant="ghost"
											onClick={() =>
												setExpandedSlotId(
													expandedSlotId === slot.id ? null : slot.id,
												)
											}
										>
											Crop
										</Button>
									)}
								</div>
								{binding && expandedSlotId === slot.id && (
									<SlotCropEditor
										binding={binding}
										onChange={(next) =>
											updateSlot({ slotId: slot.id, binding: next })
										}
									/>
								)}
							</div>
						);
					})}
				</div>
				<Button
					data-testid="template-clear-media"
					size="sm"
					variant="secondary"
					className="mt-2 w-full"
					onClick={() =>
						update({
							patch: {
								slotBindings: emptySlotBindings({ definition }),
								slotOrder: normalizeTemplateSlotOrder({ definition }),
							},
						})
					}
				>
					Clear all media
				</Button>
			</Section>
			{["timing", "layout", "appearance", "easing", "shadow"].map((group) => (
				<Section key={group} title={group}>
					<div className="space-y-2">
						{definition.parameters
							.filter((parameter) => parameter.group === group)
							.map((parameter) => (
								<ParameterControl
									key={parameter.id}
									parameter={parameter}
									value={
										element.templateParams[parameter.id] ?? parameter.default
									}
									onChange={(value) =>
										updateParam({ key: parameter.id, value })
									}
								/>
							))}
					</div>
					{group === "timing" && (
						<div className="mt-2 flex gap-1">
							{[5, 10, 15].map((seconds) => (
								<Button
									key={seconds}
									size="sm"
									variant="secondary"
									onClick={() =>
										updateParam({ key: "cycleDuration", value: seconds })
									}
								>
									{seconds}s
								</Button>
							))}
						</div>
					)}
				</Section>
			))}
			<Section title="Reset">
				<Button
					data-testid="template-reset-settings"
					size="sm"
					variant="secondary"
					className="w-full"
					onClick={() => reset({ includeMedia: false })}
				>
					Reset settings
				</Button>
				<Button
					data-testid="template-reset-all"
					size="sm"
					variant="secondary"
					className="mt-2 w-full"
					onClick={() => reset({ includeMedia: true })}
				>
					Reset all including media
				</Button>
			</Section>
			<Section title="Replace template">
				<select
					data-testid="template-replace"
					className="h-8 w-full rounded border border-border bg-background px-2 text-sm"
					value={element.templateId}
					onChange={(event) => replace({ templateId: event.target.value })}
				>
					{templateDefinitions.map((item) => (
						<option key={item.id} value={item.id}>
							{item.name}
						</option>
					))}
				</select>
			</Section>
			<Button
				variant="destructive-foreground"
				className="w-full"
				onClick={() =>
					editor.timeline.deleteElements({
						elements: [{ trackId, elementId: element.id }],
					})
				}
			>
				Remove template
			</Button>
		</div>
	);
}

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section className="rounded-md border border-border p-3">
			<h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
				{title}
			</h3>
			{children}
		</section>
	);
}

function ParameterControl({
	parameter,
	value,
	onChange,
}: {
	parameter: ReturnType<typeof getTemplateDefinition>["parameters"][number];
	value: unknown;
	onChange: (value: string | number | boolean) => void;
}) {
	if (parameter.type === "color") {
		return (
			<label className="flex items-center justify-between gap-2 text-xs">
				<span>{parameter.label}</span>
				<input
					type="color"
					value={typeof value === "string" ? value : String(parameter.default)}
					onChange={(event) => onChange(event.target.value)}
				/>
			</label>
		);
	}
	if (parameter.type === "boolean") {
		return (
			<label className="flex items-center justify-between text-xs">
				<span>{parameter.label}</span>
				<input
					type="checkbox"
					checked={value === true}
					onChange={(event) => onChange(event.target.checked)}
				/>
			</label>
		);
	}
	if (parameter.type === "select") {
		return (
			<label className="block text-xs">
				{parameter.label}
				<select
					className="mt-1 h-7 w-full rounded border border-border bg-background px-1"
					value={String(value)}
					onChange={(event) => onChange(event.target.value)}
				>
					{parameter.options?.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
			</label>
		);
	}
	const numericValue = numberValue({
		value,
		fallback: Number(parameter.default),
	});
	return (
		<div className="mt-2 block text-xs">
			<span className="flex justify-between">
				<span>{parameter.label}</span>
				<span>
					{numericValue}
					{parameter.unit}
				</span>
			</span>
			<input
				className="mt-1 w-full"
				aria-label={parameter.label}
				type="range"
				min={parameter.min ?? 0}
				max={parameter.max ?? 100}
				step={parameter.step ?? 1}
				value={numericValue}
				onChange={(event) => onChange(Number(event.target.value))}
			/>
		</div>
	);
}

function numberValue({
	value,
	fallback,
}: {
	value: unknown;
	fallback: number;
}): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function SlotCropEditor({
	binding,
	onChange,
}: {
	binding: MotionTemplateSlotBinding;
	onChange: (binding: MotionTemplateSlotBinding) => void;
}) {
	const crop = binding.crop ?? { x: 0, y: 0, scale: 1 };
	const updateCrop = ({
		key,
		value,
	}: {
		key: keyof typeof crop;
		value: number;
	}): void =>
		onChange({
			...binding,
			crop: {
				...crop,
				[key]:
					key === "scale"
						? Math.max(0.25, Math.min(4, value))
						: Math.max(-1, Math.min(1, value)),
			},
		});
	return (
		<div className="ml-12 mb-2 grid grid-cols-2 gap-2 rounded border border-border p-2 text-xs">
			<label>
				Fit
				<select
					className="mt-1 h-7 w-full rounded border border-border bg-background px-1"
					value={binding.fit ?? "cover"}
					onChange={(event) =>
						onChange({
							...binding,
							fit: parseMediaFit({ value: event.target.value }) ?? "cover",
						})
					}
				>
					<option value="cover">Cover</option>
					<option value="contain">Contain</option>
					<option value="fill">Fill</option>
				</select>
			</label>
			<label>
				Playback
				<select
					className="mt-1 h-7 w-full rounded border border-border bg-background px-1"
					value={binding.playbackMode ?? "loop"}
					onChange={(event) =>
						onChange({
							...binding,
							playbackMode:
								parsePlaybackMode({ value: event.target.value }) ?? "loop",
						})
					}
				>
					<option value="loop">Loop</option>
					<option value="freeze">Freeze last frame</option>
					<option value="trim">Trim</option>
				</select>
			</label>
			<ParameterSlider
				label="Crop X"
				value={crop.x}
				min={-1}
				max={1}
				step={0.01}
				onChange={(value) => updateCrop({ key: "x", value })}
			/>
			<ParameterSlider
				label="Crop Y"
				value={crop.y}
				min={-1}
				max={1}
				step={0.01}
				onChange={(value) => updateCrop({ key: "y", value })}
			/>
			<ParameterSlider
				label="Zoom"
				value={crop.scale}
				min={0.25}
				max={4}
				step={0.01}
				onChange={(value) => updateCrop({ key: "scale", value })}
			/>
			<Button
				size="sm"
				variant="secondary"
				onClick={() => onChange({ ...binding, crop: { x: 0, y: 0, scale: 1 } })}
			>
				Reset crop
			</Button>
		</div>
	);
}

function ParameterSlider({
	label,
	value,
	min,
	max,
	step,
	onChange,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	onChange: (value: number) => void;
}) {
	return (
		<div className="block">
			<span className="flex justify-between">
				<span>{label}</span>
				<span>{value}</span>
			</span>
			<input
				className="mt-1 w-full"
				aria-label={label}
				type="range"
				min={min}
				max={max}
				step={step}
				value={value}
				onChange={(event) => onChange(Number(event.target.value))}
			/>
		</div>
	);
}

function parseMediaFit({
	value,
}: {
	value: string;
}): MotionTemplateSlotBinding["fit"] | null {
	return value === "cover" || value === "contain" || value === "fill"
		? value
		: null;
}

function parsePlaybackMode({
	value,
}: {
	value: string;
}): MotionTemplateSlotBinding["playbackMode"] | null {
	return value === "loop" || value === "freeze" || value === "trim"
		? value
		: null;
}
