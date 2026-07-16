export type ExportCanvasSize = { width: number; height: number };

export function resolveExportCanvasSize({
	projectCanvasSize,
	override,
}: {
	projectCanvasSize: ExportCanvasSize;
	override: ExportCanvasSize | null;
}): ExportCanvasSize {
	return override ?? projectCanvasSize;
}

export function normalizeProjectExportFps({ fps }: { fps: number }): number {
	if (!Number.isFinite(fps)) return 30;
	return Math.max(1, Math.min(60, Math.round(fps)));
}

export function resolveExportFps({
	projectFps,
	override,
}: {
	projectFps: number;
	override: number | null;
}): number {
	return override ?? normalizeProjectExportFps({ fps: projectFps });
}
