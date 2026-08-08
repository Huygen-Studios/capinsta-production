import type { CapinstaTransitionEffect, CapinstaWordEffect } from "./styleTypes";

export const CAPINSTA_WORD_EFFECTS: Array<{
	id: CapinstaWordEffect;
	label: string;
}> = [
	{ id: "none", label: "None" },
	{ id: "highlight", label: "Highlight" },
	{ id: "bounce", label: "Bounce" },
	{ id: "paint", label: "Paint" },
	{ id: "pop", label: "Pop" },
	{ id: "fade", label: "Fade" },
	{ id: "reveal", label: "Reveal" },
];

export const CAPINSTA_TRANSITIONS: Array<{
	id: CapinstaTransitionEffect;
	label: string;
}> = [
	{ id: "none", label: "None" },
	{ id: "fade", label: "Fade" },
	{ id: "flip", label: "Flip" },
	{ id: "pop", label: "Pop" },
	{ id: "slide", label: "Slide" },
];
