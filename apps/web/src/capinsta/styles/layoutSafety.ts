import type { CapinstaCaptionStyleV1 } from "./styleTypes";

export interface ResolvedCapinstaSafeLayout {
	leftPercent: number;
	topPercent: number;
	maxWidthPercent: number;
	transform: string;
	opacity: number;
	textAlign: "left" | "center" | "right";
}

export function resolveCapinstaSafeLayout({
	style,
	estimatedHeightPercent = 0,
}: {
	style: CapinstaCaptionStyleV1;
	estimatedHeightPercent?: number;
}): ResolvedCapinstaSafeLayout {
	const safetyInset = style.layout.safeAreaEnabled ? 6 : 0;
	const halfWidth = (style.layout.maxWidth * style.layout.scale) / 2;
	const minX = Math.min(50, safetyInset + halfWidth);
	const maxX = Math.max(50, 100 - safetyInset - halfWidth);
	const leftPercent = Math.min(maxX, Math.max(minX, style.layout.positionX));
	const halfHeight = estimatedHeightPercent / 2;
	const minY = Math.min(50, safetyInset + halfHeight);
	const maxY = Math.max(50, 100 - safetyInset - halfHeight);
	const topPercent = Math.min(
		maxY,
		Math.max(minY, style.layout.positionY),
	);
	return {
		leftPercent,
		topPercent,
		maxWidthPercent: Math.min(100 - safetyInset * 2, style.layout.maxWidth),
		transform: `translate(-50%, -50%) scale(${style.layout.scale}) rotate(${style.layout.rotation}deg)`,
		opacity: style.layout.opacity,
		textAlign: style.text.alignment,
	};
}
