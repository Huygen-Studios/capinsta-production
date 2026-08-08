import type { CSSProperties } from "react";
import type { CapinstaCaptionStyleV1 } from "../styles/styleTypes";

function interpolate({
	input,
	inMin,
	inMax,
	outMin,
	outMax,
}: {
	input: number;
	inMin: number;
	inMax: number;
	outMin: number;
	outMax: number;
}) {
	const t = Math.max(0, Math.min(1, (input - inMin) / (inMax - inMin)));
	return outMin + (outMax - outMin) * t;
}

export function getCapinstaEntranceStyle({
	transition,
	progress,
	style,
}: {
	transition: string;
	progress: number;
	style?: CapinstaCaptionStyleV1;
}): CSSProperties {
	if (transition === "fade") return { opacity: progress };
	if (transition === "slide") {
		const y = interpolate({
			input: progress,
			inMin: 0,
			inMax: 1,
			outMin: 12,
			outMax: 0,
		});
		return {
			opacity: progress,
			transform: `translateY(${y}px)`,
		};
	}
	if (transition === "flip") {
		return {
			opacity: progress,
			transform: `perspective(420px) rotateX(${(1 - progress) * -70}deg) scale(1)`,
			transformOrigin: "center",
		};
	}
	if (transition === "pop") {
		const boxScale =
			progress < 0.72
				? interpolate({
						input: progress,
						inMin: 0,
						inMax: 0.72,
						outMin: 0.85,
						outMax: 1.05,
					})
				: interpolate({
						input: progress,
						inMin: 0.72,
						inMax: 1,
						outMin: 1.05,
						outMax: 1,
					});
		return {
			opacity: progress,
			transform: `scale(${boxScale})`,
		};
	}
	if (style?.reveal.blur && transition === "fade") {
		return {
			opacity: progress,
			filter: `blur(${(1 - progress) * style.reveal.blur}px)`,
		};
	}
	return {};
}

function activeWordTransform({
	ageFrames,
	style,
}: {
	ageFrames: number;
	style: CapinstaCaptionStyleV1;
}): string {
	if (style.animation.type === "none" || style.animation.strength <= 0) {
		return "translateY(0) scale(1)";
	}

	const speed = Math.max(0.4, style.animation.speed);
	const smoothness = Math.max(0, Math.min(1, style.animation.smoothness));
	const peakFrame = Math.max(2, (3 + smoothness * 2) / speed);
	const settleFrame = Math.max(peakFrame + 2, (8 + smoothness * 4) / speed);
	const maxScale =
		1 + (style.activeWord.scale - 1) * style.animation.strength;
	const lift =
		style.animation.type === "bounce"
			? -4 * style.animation.strength
			: -2.5 * style.animation.strength;

	if (ageFrames <= peakFrame) {
		const startScale = interpolate({
			input: style.animation.strength,
			inMin: 0,
			inMax: 1.4,
			outMin: 1,
			outMax: 0.98,
		});
		const scale = interpolate({
			input: ageFrames,
			inMin: 0,
			inMax: peakFrame,
			outMin: startScale,
			outMax: maxScale,
		});
		const y = interpolate({
			input: ageFrames,
			inMin: 0,
			inMax: peakFrame,
			outMin: 5 * style.animation.strength,
			outMax: lift,
		});
		const squash = style.layout.asymmetricScaleEnabled
			? Math.sin(Math.min(1, ageFrames / peakFrame) * Math.PI) *
				style.layout.asymmetricScaleStrength
			: 0;
		return `translateY(${y}px) scale(${scale}) scaleX(${1 + squash * 0.08}) scaleY(${1 - squash * 0.045})`;
	}

	if (ageFrames <= settleFrame) {
		const settle =
			style.animation.type === "bounce" && ageFrames < settleFrame - 2
				? 0.98
				: 1;
		const scale = interpolate({
			input: ageFrames,
			inMin: peakFrame,
			inMax: settleFrame,
			outMin: maxScale,
			outMax: settle,
		});
		const y = interpolate({
			input: ageFrames,
			inMin: peakFrame,
			inMax: settleFrame,
			outMin: lift,
			outMax: 0,
		});
		const squash = style.layout.asymmetricScaleEnabled
			? Math.sin(
					Math.max(
						0,
						1 -
							(ageFrames - peakFrame) /
								Math.max(0.001, settleFrame - peakFrame),
					) * Math.PI,
				) * style.layout.asymmetricScaleStrength
			: 0;
		return `translateY(${y}px) scale(${scale}) scaleX(${1 + squash * 0.08}) scaleY(${1 - squash * 0.045})`;
	}

	return "translateY(0) scale(1)";
}

export function getCapinstaActiveWordEffectStyle({
	effect,
	strength,
	timeSeconds,
	wordStart,
	activeStyle,
	style,
	fps = 30,
}: {
	effect: string;
	strength: number;
	timeSeconds: number;
	wordStart: number;
	activeStyle: CSSProperties;
	style?: CapinstaCaptionStyleV1;
	fps?: number;
}): CSSProperties {
	const age = Math.max(0, timeSeconds - wordStart);
	const originalTransform = style
		? activeWordTransform({ ageFrames: age * fps, style })
		: undefined;
	const pulse = Math.max(0, 1 - age * 8);
	if (effect === "bounce") {
		return {
			...activeStyle,
			transform:
				originalTransform ??
				`translateY(${-8 * strength * pulse}px) scale(${1 + 0.08 * strength})`,
		};
	}
	if (effect === "paint") {
		return {
			...activeStyle,
			backgroundImage: `linear-gradient(90deg, ${activeStyle.color ?? "#fde047"}, ${activeStyle.color ?? "#fde047"})`,
			backgroundRepeat: "no-repeat",
			backgroundSize: `${Math.min(100, 30 + age * 240)}% 0.18em`,
			backgroundPosition: "0 88%",
		};
	}
	if (effect === "fade") {
		return {
			...activeStyle,
			opacity: Math.min(1, 0.45 + age * 6),
			transform: originalTransform,
		};
	}
	if (effect === "pop") {
		return {
			...activeStyle,
			transform:
				originalTransform ?? `scale(${1 + 0.14 * strength * pulse})`,
		};
	}
	if (effect === "highlight") return activeStyle;
	if (effect === "none") return {};
	return activeStyle;
}
