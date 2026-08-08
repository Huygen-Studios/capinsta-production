import type { ExportOptions } from "./index";

export const DEFAULT_EXPORT_OPTIONS = {
	exportMode: "captions_solid_background",
	format: "mp4",
	quality: "balanced",
	includeAudio: true,
	backgroundColor: "#00FF00",
	canvasSize: {
		width: 1080,
		height: 1920,
	},
	fps: {
		numerator: 30,
		denominator: 1,
	},
} satisfies ExportOptions;
