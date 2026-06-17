"use client";

import type {
	CapinstaCaptionStylePatch,
	CapinstaTransitionEffect,
	CapinstaWordEffect,
} from "../styles/styleTypes";
import { cn } from "@/utils/ui";

const WORD_EFFECT_CARDS: Array<{
	id: CapinstaWordEffect;
	label: string;
	preview: "plain" | "highlight" | "paint";
	patch: CapinstaCaptionStylePatch;
}> = [
	{ id: "none", label: "None", preview: "plain", patch: { animation: { wordEffect: "none", type: "none", strength: 0 } } },
	{ id: "highlight", label: "Highlight", preview: "highlight", patch: { animation: { wordEffect: "highlight", type: "pop", strength: 0.9 }, activeWord: { backgroundEnabled: true, backgroundOpacity: 1 } } },
	{ id: "bounce", label: "Bounce", preview: "plain", patch: { animation: { wordEffect: "bounce", type: "bounce", strength: 1 } } },
	{ id: "paint", label: "Paint", preview: "paint", patch: { animation: { wordEffect: "paint", type: "none", strength: 0.55 } } },
	{ id: "pop", label: "Pop", preview: "plain", patch: { animation: { wordEffect: "pop", type: "pop", strength: 1.2 } } },
	{ id: "fade", label: "Fade", preview: "plain", patch: { animation: { wordEffect: "fade", type: "none", entrance: "fade", transition: "fade", strength: 0.45 } } },
];

const TRANSITION_CARDS: Array<{
	id: CapinstaTransitionEffect;
	label: string;
	patch: CapinstaCaptionStylePatch;
}> = [
	{ id: "none", label: "None", patch: { animation: { transition: "none", entrance: "none" } } },
	{ id: "fade", label: "Fade", patch: { animation: { transition: "fade", entrance: "fade" } } },
	{ id: "flip", label: "Flip", patch: { animation: { transition: "flip", entrance: "flip" } } },
	{ id: "pop", label: "Pop", patch: { animation: { transition: "pop", entrance: "pop" } } },
	{ id: "slide", label: "Slide", patch: { animation: { transition: "slide", entrance: "slide" } } },
];

export function CapinstaAnimationGrid({
	wordEffect,
	transition,
	activeWordColor,
	onPatch,
}: {
	wordEffect: CapinstaWordEffect;
	transition: CapinstaTransitionEffect;
	activeWordColor: string;
	onPatch: (patch: CapinstaCaptionStylePatch) => void;
}) {
	return (
		<div className="grid gap-4">
			<div className="grid gap-2">
				<div className="text-muted-foreground text-xs">Word effect</div>
				<div className="grid grid-cols-3 gap-2">
					{WORD_EFFECT_CARDS.map((card) => (
						<button
							key={card.id}
							type="button"
							onClick={() => onPatch(card.patch)}
							className={cn(
								"rounded-sm border p-2 text-xs transition-colors",
								wordEffect === card.id
									? "border-primary bg-primary/10"
									: "hover:bg-accent",
							)}
						>
							<div className="mb-1 flex h-8 items-center justify-center overflow-hidden rounded-sm bg-black text-[10px] font-bold text-white">
								<span>CAP</span>
								<span
									className="mx-1 rounded-sm px-1"
									style={{
										color:
											card.preview === "paint" ? activeWordColor : undefined,
										background:
											card.preview === "highlight"
												? activeWordColor
												: undefined,
									}}
								>
									IN
								</span>
								<span>STA</span>
							</div>
							{card.label}
						</button>
					))}
				</div>
			</div>
			<div className="grid gap-2">
				<div className="text-muted-foreground text-xs">Transition</div>
				<div className="grid grid-cols-3 gap-2">
					{TRANSITION_CARDS.map((card) => (
						<button
							key={card.id}
							type="button"
							onClick={() => onPatch(card.patch)}
							className={cn(
								"rounded-sm border p-2 text-xs transition-colors",
								transition === card.id
									? "border-primary bg-primary/10"
									: "hover:bg-accent",
							)}
						>
							<div className="mb-1 flex h-8 items-center justify-center rounded-sm bg-black text-[10px] font-bold text-white">
								{card.label}
							</div>
							{card.label}
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
