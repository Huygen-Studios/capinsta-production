"use client";

import { useEffect, useRef, useState } from "react";
import { Box, Plus, FoldHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { useEditor } from "@/editor/use-editor";
import {
	LAYER_3D_PRESETS,
	createLayer3DEffect,
	evaluateLayer3DEffect,
	type Layer3DPresetDefinition,
} from "@/layer-3d";

export function Layer3DEffectsView() {
	const editor = useEditor();
	const selected = useEditor((instance) =>
		instance.selection.getSelectedElements(),
	);
	const target = editor.timeline
		.getElementsWithTracks({ elements: selected })
		.find(({ element }) => isCompatible({ element }));
	const paperFoldTarget = editor.timeline
		.getElementsWithTracks({ elements: selected })
		.find(({ element }) => isPaperFoldCompatible({ element }));

	const apply = ({ presetId }: { presetId: Layer3DPresetDefinition["id"] }) => {
		if (!target || !isCompatible({ element: target.element })) return;
		editor.timeline.updateElements({
			updates: [
				{
					trackId: target.track.id,
					elementId: target.element.id,
					patch: { layer3DEffect: createLayer3DEffect({ presetId }) },
				},
			],
		});
	};

	return (
		<PanelView title="Effects" contentClassName="pb-4">
			<section
				aria-labelledby="paper-fold-effects-heading"
				className="mb-5 space-y-2"
			>
				<div className="flex items-center gap-2 px-1 py-1">
					<FoldHorizontal className="size-4 text-primary" />
					<h2
						id="paper-fold-effects-heading"
						className="text-xs font-semibold uppercase text-muted-foreground"
					>
						Animation &amp; Stylize
					</h2>
				</div>
				{!paperFoldTarget ? (
					<p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
						Select a video, image, text, sticker, or graphic layer to apply
						Paper Fold.
					</p>
				) : null}
				<article className="rounded-md border bg-background p-2">
					<div
						className="relative h-24 overflow-hidden rounded-sm border bg-[#171717]"
						aria-label="Paper Fold preview"
					>
						<div className="absolute inset-4 origin-center rotate-[-4deg] rounded-sm bg-gradient-to-br from-[#fff8e8] via-[#cfc1a6] to-[#f4e6c8] shadow-xl [clip-path:polygon(0_0,100%_10%,88%_100%,8%_88%)]" />
						<div className="absolute left-1/2 top-4 h-16 w-px bg-black/25" />
					</div>
					<div className="mt-2 flex items-start justify-between gap-2">
						<div className="min-w-0">
							<h3 className="text-sm font-medium">Paper Fold</h3>
							<p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
								Fold media into or unfold it from animated paper.
							</p>
						</div>
						<Button
							size="sm"
							disabled={!paperFoldTarget}
							onClick={() => {
								if (!paperFoldTarget) return;
								editor.timeline.addClipEffect({
									trackId: paperFoldTarget.track.id,
									elementId: paperFoldTarget.element.id,
									effectType: "paper-fold",
								});
							}}
							aria-label="Apply Paper Fold"
						>
							<Plus className="size-3.5" />
							Apply
						</Button>
					</div>
				</article>
			</section>
			<section aria-labelledby="layer-3d-effects-heading" className="space-y-2">
				<div className="flex items-center gap-2 px-1 py-1">
					<Box className="size-4 text-primary" />
					<h2
						id="layer-3d-effects-heading"
						className="text-xs font-semibold uppercase text-muted-foreground"
					>
						3D Motion
					</h2>
				</div>
				{!target ? (
					<p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
						Select an image, video, or supported graphic layer to apply 3D
						Motion.
					</p>
				) : null}
				<div className="grid gap-2">
					{LAYER_3D_PRESETS.map((definition) => (
						<Layer3DEffectCard
							key={definition.id}
							definition={definition}
							disabled={!target}
							onApply={() => apply({ presetId: definition.id })}
						/>
					))}
				</div>
			</section>
		</PanelView>
	);
}

function isPaperFoldCompatible({ element }: { element: unknown }): boolean {
	if (!element || typeof element !== "object" || !("type" in element))
		return false;
	return (
		element.type === "image" ||
		element.type === "video" ||
		element.type === "text" ||
		element.type === "sticker" ||
		element.type === "graphic"
	);
}

function isCompatible({ element }: { element: unknown }): boolean {
	if (!element || typeof element !== "object" || !("type" in element))
		return false;
	return (
		element.type === "image" ||
		element.type === "video" ||
		element.type === "graphic"
	);
}

function Layer3DEffectCard({
	definition,
	disabled,
	onApply,
}: {
	definition: Layer3DPresetDefinition;
	disabled: boolean;
	onApply: () => void;
}) {
	return (
		<article
			className="rounded-md border bg-background p-2"
			onDoubleClick={() => {
				if (!disabled) onApply();
			}}
		>
			<Layer3DThumbnail definition={definition} />
			<div className="mt-2 flex items-start justify-between gap-2">
				<div className="min-w-0">
					<h3 className="text-sm font-medium">{definition.name}</h3>
					<p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
						{definition.description}
					</p>
				</div>
				<Button
					size="sm"
					disabled={disabled}
					onClick={onApply}
					aria-label={`Apply ${definition.name}`}
				>
					<Plus className="size-3.5" />
					Apply
				</Button>
			</div>
		</article>
	);
}

let activePreviews = 0;
const MAX_ACTIVE_PREVIEWS = 4;

function Layer3DThumbnail({
	definition,
}: {
	definition: Layer3DPresetDefinition;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const observer = new IntersectionObserver(
			([entry]) => setVisible(Boolean(entry?.isIntersecting)),
			{ threshold: 0.1 },
		);
		observer.observe(canvas);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const context = canvas.getContext("2d");
		if (!context) return;
		const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
		let frame = 0;
		let active = false;
		let startedAt = performance.now();
		const draw = (time: number) => {
			const elapsed = reducedMotion.matches
				? definition.defaults.animation.duration * 0.42
				: (time - startedAt) / 1000;
			const evaluated = evaluateLayer3DEffect({
				effect: definition.defaults,
				localTimeSeconds: elapsed,
				frame: { width: canvas.width, height: canvas.height },
				layer: { width: 112, height: 68 },
			});
			context.clearRect(0, 0, canvas.width, canvas.height);
			context.fillStyle = "#101014";
			context.fillRect(0, 0, canvas.width, canvas.height);
			if (evaluated) {
				const corners = evaluated.projectedCorners;
				context.beginPath();
				context.moveTo(corners[0].x, corners[0].y);
				for (let index = 1; index < corners.length; index++)
					context.lineTo(corners[index].x, corners[index].y);
				context.closePath();
				const gradient = context.createLinearGradient(
					corners[0].x,
					0,
					corners[1].x,
					canvas.height,
				);
				gradient.addColorStop(0, "#67E8F9");
				gradient.addColorStop(0.5, "#A3E635");
				gradient.addColorStop(1, "#F472B6");
				context.fillStyle = gradient;
				context.fill();
			}
			if (!reducedMotion.matches && visible && !document.hidden)
				frame = requestAnimationFrame(draw);
		};
		const start = () => {
			if (
				active ||
				!visible ||
				document.hidden ||
				activePreviews >= MAX_ACTIVE_PREVIEWS
			)
				return;
			active = true;
			activePreviews += 1;
			startedAt = performance.now();
			frame = requestAnimationFrame(draw);
		};
		const stop = () => {
			if (frame) cancelAnimationFrame(frame);
			frame = 0;
			if (active) activePreviews = Math.max(0, activePreviews - 1);
			active = false;
		};
		const visibilityChanged = () => (document.hidden ? stop() : start());
		const motionChanged = () => {
			stop();
			draw(performance.now());
			if (!reducedMotion.matches) start();
		};
		document.addEventListener("visibilitychange", visibilityChanged);
		reducedMotion.addEventListener("change", motionChanged);
		if (reducedMotion.matches) draw(performance.now());
		else start();
		return () => {
			stop();
			document.removeEventListener("visibilitychange", visibilityChanged);
			reducedMotion.removeEventListener("change", motionChanged);
		};
	}, [definition, visible]);

	return (
		<canvas
			ref={canvasRef}
			width={160}
			height={96}
			className="block w-full rounded-sm border bg-black"
			aria-label={`${definition.name} animated preview`}
		/>
	);
}
