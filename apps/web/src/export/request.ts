import type { ExportMode, ExportQuality } from "./index";
import { resolveSolidExportBackground } from "./color";

export function createExportRequestFormData({
	sourceJobId,
	captionsJson,
	theme,
	styleConfigJson,
	width,
	height,
	fps,
	includeAudio,
	quality,
	exportMode,
	backgroundColor,
	durationSeconds,
}: {
	sourceJobId: string;
	captionsJson: string;
	theme: string;
	styleConfigJson: string;
	width: number;
	height: number;
	fps: number;
	includeAudio: boolean;
	quality: ExportQuality;
	exportMode: ExportMode;
	backgroundColor: string | null | undefined;
	durationSeconds: number;
}): FormData {
	const formData = new FormData();
	formData.append("source_job_id", sourceJobId);
	formData.append("captions_json", captionsJson);
	formData.append("theme", theme);
	formData.append("style_config_json", styleConfigJson);
	formData.append("resolution", `${width}x${height}`);
	formData.append("export_width", width.toString());
	formData.append("export_height", height.toString());
	formData.append("export_fps", fps.toString());
	formData.append("include_audio", includeAudio ? "true" : "false");
	formData.append("quality", quality);
	formData.append("export_mode", exportMode);
	formData.append("captions_only", "false");
	formData.append(
		"background_color",
		resolveSolidExportBackground({ value: backgroundColor }),
	);
	formData.append("duration_override", durationSeconds.toString());
	formData.append("duration_source", "frontend");
	formData.append("render_mode", "headless");
	return formData;
}
