export interface RenderTextOverlay {
	id: string;
	text: string;
	start: number;
	end: number;
	fontSize: number;
	fontFamily: string;
	fontWeight: string | number;
	color: string;
	positionX: number;
	positionY: number;
	lineHeight: number;
	backgroundColor: string;
	backgroundEnabled: boolean;
	paddingX: number;
	paddingY: number;
	cornerRadius: number;
}

const TICKS_PER_SECOND = 120_000;

export function textOverlaysFromComposition(value: unknown): RenderTextOverlay[] {
	if (!value || typeof value !== "object") return [];
	const scenes = Reflect.get(value, "scenes");
	if (!Array.isArray(scenes)) return [];
	const overlays: RenderTextOverlay[] = [];
	for (const scene of scenes) {
		if (!scene || typeof scene !== "object") continue;
		const tracks = Reflect.get(Reflect.get(scene, "tracks") ?? {}, "overlay");
		if (!Array.isArray(tracks)) continue;
		for (const track of tracks) {
			if (!track || typeof track !== "object") continue;
			const id = String(Reflect.get(track, "id") ?? "");
			const name = String(Reflect.get(track, "name") ?? "");
			if (!id.endsWith("__automatic_hook") && name !== "Automatic hook") continue;
			const elements = Reflect.get(track, "elements");
			if (!Array.isArray(elements)) continue;
			for (const element of elements) {
				if (!element || typeof element !== "object") continue;
				const params = Reflect.get(element, "params");
				if (!params || typeof params !== "object") continue;
				const text = String(Reflect.get(params, "content") ?? "").slice(0, 200);
				const start = Number(Reflect.get(element, "startTime")) / TICKS_PER_SECOND;
				const duration = Number(Reflect.get(element, "duration")) / TICKS_PER_SECOND;
				if (!text || !Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) continue;
				overlays.push({
					id: String(Reflect.get(element, "id") ?? `${id}-element`),
					text,
					start,
					end: start + duration,
					fontSize: Number(Reflect.get(params, "fontSize")) || 72,
					fontFamily: String(Reflect.get(params, "fontFamily") || "Poppins, Noto Color Emoji"),
					fontWeight: String(Reflect.get(params, "fontWeight") || "bold"),
					color: String(Reflect.get(params, "color") || "#ffffff"),
					positionX: Number(Reflect.get(params, "transform.positionX")) || 0,
					positionY: Number(Reflect.get(params, "transform.positionY")) || 0,
					lineHeight: Number(Reflect.get(params, "lineHeight")) || 1.05,
					backgroundColor: String(Reflect.get(params, "background.color") || "#000000cc"),
					backgroundEnabled: Reflect.get(params, "background.enabled") === true,
					paddingX: Number(Reflect.get(params, "background.paddingX")) || 0,
					paddingY: Number(Reflect.get(params, "background.paddingY")) || 0,
					cornerRadius: Number(Reflect.get(params, "background.cornerRadius")) || 0,
				});
			}
		}
	}
	return overlays;
}
