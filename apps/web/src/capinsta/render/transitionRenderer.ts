import type { CapinstaCaptionStyleV1 } from "../styles/styleTypes";

export function getCapinstaTransitionProgress({
	style,
	clipStart,
	timeSeconds,
}: {
	style: CapinstaCaptionStyleV1;
	clipStart: number;
	timeSeconds: number;
}): number {
	if (style.animation.transition === "none") return 1;
	const duration = Math.max(0.08, 0.28 / style.animation.speed);
	return Math.min(1, Math.max(0, (timeSeconds - clipStart) / duration));
}
