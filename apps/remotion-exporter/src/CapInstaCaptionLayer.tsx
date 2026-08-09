import { useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { CapinstaCaptionRenderer } from "../../web/src/capinsta/render/CapinstaCaptionRenderer";
import type { CapInstaRemotionPropsV1 } from "./contracts";

export const captionTimeSeconds = (frame: number, fps: number) => frame / fps;

export function CapInstaCaptionLayer({ props }: { props: CapInstaRemotionPropsV1 }) {
	const frame = useCurrentFrame();
	const { fps, width, height } = useVideoConfig();
	const document = props.captions?.document;
	const clips = useMemo(
		() => document ? [...document.clips].sort((left, right) => left.start - right.start || left.id.localeCompare(right.id)) : [],
		[document],
	);
	const timeSeconds = captionTimeSeconds(frame, fps);
	const clip = clips.find((candidate) => candidate.start <= timeSeconds && timeSeconds < candidate.end);
	if (!document || !clip) return null;

	return (
		<CapinstaCaptionRenderer
			document={document}
			clip={clip}
			activeWordIds={[]}
			timeSeconds={timeSeconds}
			renderMode="export"
			fps={fps}
			viewport={{ width, height }}
		/>
	);
}
