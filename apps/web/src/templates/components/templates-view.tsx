"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
	Add01Icon,
	ArrowDown01Icon,
	ArrowUp01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { useEditor } from "@/editor/use-editor";
import { buildMotionTemplateElement } from "@/timeline/element-utils";
import {
	evaluateTemplateScene,
	projectedCardScaleX,
	projectedCardScaleY,
	templateFrameRatioForCanvas,
	templateDefinitions,
	type MotionTemplateDefinition,
	type TemplateCategory,
} from "@/templates";
import { createMotionTemplateDragData } from "@/templates/drag";
import { cn } from "@/utils/ui";
import { TemplateInspector } from "./template-inspector";

const groups: Array<{ id: TemplateCategory; label: string }> = [
	{ id: "3d-perspective", label: "3D & Perspective" },
	{ id: "carousel-flow", label: "Carousel & Flow" },
	{ id: "stack-scatter", label: "Stack & Scatter" },
];
const maxAnimatedThumbnails = 6;
let activeThumbnailCount = 0;

export function TemplatesView() {
	const editor = useEditor();
	const selectedTimeline = useEditor((instance) =>
		instance.selection.getSelectedElements(),
	);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [open, setOpen] = useState<Record<TemplateCategory, boolean>>({
		"3d-perspective": true,
		"carousel-flow": true,
		"stack-scatter": true,
	});
	const selectedDefinition = useMemo(
		() =>
			templateDefinitions.find((definition) => definition.id === selectedId) ??
			null,
		[selectedId],
	);
	const selectedTemplate = editor.timeline
		.getElementsWithTracks({ elements: selectedTimeline })
		.find(({ element }) => element.type === "motion-template");

	if (selectedTemplate?.element.type === "motion-template") {
		return (
			<PanelView title="Template">
				<div data-testid="template-inspector">
					<TemplateInspector
						element={selectedTemplate.element}
						trackId={selectedTemplate.track.id}
					/>
				</div>
			</PanelView>
		);
	}

	const add = ({ templateId }: { templateId: string }) => {
		const canvasSize = editor.project.getActive()?.settings.canvasSize;
		const element = buildMotionTemplateElement({
			templateId,
			startTime: editor.playback.getCurrentTime(),
			...(canvasSize
				? { frameRatio: templateFrameRatioForCanvas(canvasSize) }
				: {}),
		});
		editor.timeline.insertElement({ element, placement: { mode: "auto" } });
	};

	return (
		<PanelView title="Templates" contentClassName="pb-3">
			<div data-testid="templates-panel">
				{selectedDefinition && (
					<div className="mb-2 flex items-center justify-between rounded-md border border-primary/50 bg-primary/10 p-2">
						<span className="text-sm font-medium">
							{selectedDefinition.name}
						</span>
						<Button
							data-testid="template-add-button"
							size="sm"
							onClick={() => add({ templateId: selectedDefinition.id })}
						>
							<HugeiconsIcon icon={Add01Icon} />
							Add
						</Button>
					</div>
				)}
				{groups.map((group) => {
					const definitions = templateDefinitions.filter(
						(item) => item.category === group.id,
					);
					const isOpen = open[group.id];
					return (
						<section
							key={group.id}
							data-testid="template-category"
							data-template-category={group.id}
							className="border-b border-border py-2 last:border-0"
						>
							<button
								type="button"
								className="flex w-full items-center justify-between px-1 py-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground"
								onClick={() =>
									setOpen((value) => ({ ...value, [group.id]: !isOpen }))
								}
							>
								{group.label} · {definitions.length}
								<HugeiconsIcon
									icon={isOpen ? ArrowUp01Icon : ArrowDown01Icon}
									className="size-4"
								/>
							</button>
							{isOpen && (
								<div className="mt-2 grid gap-2">
									{definitions.map((definition) => (
										<TemplateCard
											key={definition.id}
											definition={definition}
											selected={selectedId === definition.id}
											onSelect={() => setSelectedId(definition.id)}
											onAdd={() => add({ templateId: definition.id })}
										/>
									))}
								</div>
							)}
						</section>
					);
				})}
			</div>
		</PanelView>
	);
}

function TemplateCard({
	definition,
	selected,
	onSelect,
	onAdd,
}: {
	definition: MotionTemplateDefinition;
	selected: boolean;
	onSelect: () => void;
	onAdd: () => void;
}) {
	const editor = useEditor();
	const canvasSize = editor.project.getActive()?.settings.canvasSize;
	return (
		<button
			type="button"
			data-testid="template-card"
			data-template-id={definition.id}
			draggable
			onDragStart={(event) =>
				editor.timeline.dragSource.begin({
					dataTransfer: event.dataTransfer,
					dragData: createMotionTemplateDragData({
						definition,
						...(canvasSize
							? { frameRatio: templateFrameRatioForCanvas(canvasSize) }
							: {}),
					}),
				})
			}
			onDragEnd={() => editor.timeline.dragSource.end()}
			onClick={onSelect}
			onDoubleClick={onAdd}
			className={cn(
				"group cursor-grab rounded-md border p-2 text-left focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing",
				selected
					? "border-primary bg-primary/8"
					: "border-transparent hover:bg-accent",
			)}
			aria-label={`${definition.name}: ${definition.description}`}
		>
			<TemplateThumbnailCanvas definition={definition} />
			<div className="mt-2 flex items-start justify-between gap-2">
				<div>
					<div className="text-sm font-medium text-foreground">
						{definition.name}
					</div>
					<p className="mt-0.5 text-xs leading-4 text-muted-foreground">
						{definition.description}
					</p>
				</div>
				<span className="sr-only">Drag or double click to add to timeline</span>
			</div>
		</button>
	);
}

function TemplateThumbnailCanvas({
	definition,
}: {
	definition: MotionTemplateDefinition;
}) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const visibleRef = useRef(false);
	const reducedMotionRef = useRef(false);
	const frameRef = useRef<number | null>(null);
	const hasActiveSlotRef = useRef(false);
	const startedAtRef = useRef<number | null>(null);
	const element = useMemo(
		() => ({
			templateId: definition.id,
			slotBindings: Object.fromEntries(
				definition.mediaSlots.map((slot) => [slot.id, null]),
			),
			slotOrder: definition.mediaSlots.map((slot) => slot.id),
			templateParams: definition.defaults,
		}),
		[definition],
	);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const context = canvas.getContext("2d");
		if (!context) return;

		const render = ({ time }: { time: number }) => {
			drawTemplateThumbnail({
				context,
				width: canvas.width,
				height: canvas.height,
				definition,
				element,
				time,
			});
		};
		const releaseActiveSlot = () => {
			if (!hasActiveSlotRef.current) return;
			hasActiveSlotRef.current = false;
			activeThumbnailCount = Math.max(0, activeThumbnailCount - 1);
		};
		const cancelFrame = () => {
			if (frameRef.current !== null) {
				window.cancelAnimationFrame(frameRef.current);
				frameRef.current = null;
			}
		};
		const shouldAnimate = () =>
			visibleRef.current &&
			!document.hidden &&
			!reducedMotionRef.current &&
			(hasActiveSlotRef.current ||
				activeThumbnailCount < maxAnimatedThumbnails);
		const schedule = () => {
			cancelFrame();
			if (!shouldAnimate()) {
				releaseActiveSlot();
				render({ time: 0.8 });
				return;
			}
			if (!hasActiveSlotRef.current) {
				hasActiveSlotRef.current = true;
				activeThumbnailCount += 1;
			}
			startedAtRef.current = performance.now();
			const tick = (now: number) => {
				if (!shouldAnimate()) {
					cancelFrame();
					releaseActiveSlot();
					render({ time: 0.8 });
					return;
				}
				const startedAt = startedAtRef.current ?? now;
				render({ time: ((now - startedAt) / 1000) % 4 });
				frameRef.current = window.requestAnimationFrame(tick);
			};
			frameRef.current = window.requestAnimationFrame(tick);
		};

		render({ time: 0.8 });
		const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
		reducedMotionRef.current = mediaQuery.matches;
		const handleMediaChange = () => {
			reducedMotionRef.current = mediaQuery.matches;
			schedule();
		};
		const handleVisibility = () => schedule();
		mediaQuery.addEventListener("change", handleMediaChange);
		document.addEventListener("visibilitychange", handleVisibility);

		const observer =
			"IntersectionObserver" in window
				? new IntersectionObserver((entries) => {
						visibleRef.current = entries.some((entry) => entry.isIntersecting);
						schedule();
					})
				: null;
		if (observer) {
			observer.observe(canvas);
		} else {
			visibleRef.current = true;
			schedule();
		}

		return () => {
			cancelFrame();
			releaseActiveSlot();
			observer?.disconnect();
			mediaQuery.removeEventListener("change", handleMediaChange);
			document.removeEventListener("visibilitychange", handleVisibility);
		};
	}, [definition, element]);

	return (
		<div className="h-28 overflow-hidden rounded-sm bg-[#101014]">
			<canvas
				ref={canvasRef}
				data-testid="template-thumbnail-canvas"
				data-template-id={definition.id}
				width={240}
				height={112}
				className="size-full"
				aria-hidden="true"
			/>
		</div>
	);
}

function drawTemplateThumbnail({
	context,
	width,
	height,
	definition,
	element,
	time,
}: {
	context: CanvasRenderingContext2D;
	width: number;
	height: number;
	definition: MotionTemplateDefinition;
	element: Parameters<typeof evaluateTemplateScene>[0]["element"];
	time: number;
}) {
	context.clearRect(0, 0, width, height);
	context.fillStyle = "#101014";
	context.fillRect(0, 0, width, height);
	const layers = evaluateTemplateScene({
		element,
		localTime: time,
		durationSeconds: definition.defaultDuration,
	});
	for (const [index, layer] of layers.entries()) {
		const cardWidth = Math.max(8, width * layer.scale);
		const cardHeight = cardWidth / Math.max(0.1, layer.cardRatio);
		context.save();
		context.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
		context.translate(layer.x * width, layer.y * height);
		context.rotate((layer.rotation * Math.PI) / 180);
		context.scale(
			projectedCardScaleX({ rotationY: layer.rotationY }),
			projectedCardScaleY({ rotationX: layer.rotationX }),
		);
		context.fillStyle = `hsl(${(index * 47 + definition.id.length * 13) % 360} 8% ${48 + index * 2}%)`;
		context.fillRect(-cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight);
		context.restore();
	}
}
