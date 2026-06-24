import type { TrackType } from "@/timeline";

export const TIMELINE_AUDIO_WAVEFORM_COLOR = "rgba(10, 10, 10, 0.72)";

export const TIMELINE_TRACK_THEME: Record<
	TrackType,
	{
		elementClassName: string;
		waveformColor?: string;
	}
> = {
	video: { elementClassName: "bg-[var(--neo-blue)]" },
	text: { elementClassName: "bg-[var(--neo-pink)]" },
	audio: {
		elementClassName: "bg-[var(--neo-teal)]",
		waveformColor: TIMELINE_AUDIO_WAVEFORM_COLOR,
	},
	graphic: { elementClassName: "bg-[var(--neo-yellow)]" },
	effect: { elementClassName: "bg-[var(--neo-coral)]" },
} as const;

export const SELECTED_TRACK_ROW_CLASS = "bg-primary/15";
export const DEFAULT_TIMELINE_BOOKMARK_COLOR = "#91A7FF";

export function getTimelineElementClassName({
	type,
}: {
	type: TrackType;
}): string {
	return TIMELINE_TRACK_THEME[type].elementClassName.trim();
}
