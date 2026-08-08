"use client";

import { CAPINSTA_CAPTION_PRESETS } from "../styles/presetRegistry";
import type { CapinstaCaptionPresetId } from "../styles/styleTypes";
import { cn } from "@/utils/ui";
import { styleToPreview } from "../styles/styleToPreview";

export function CapinstaPresetGrid({
	activePresetId,
	onSelectPreset,
}: {
	activePresetId: string;
	onSelectPreset: (presetId: CapinstaCaptionPresetId) => void;
}) {
	return (
		<div className="grid grid-cols-2 gap-2">
			{CAPINSTA_CAPTION_PRESETS.map((preset) => (
				<PresetButton
					key={preset.id}
					preset={preset}
					selected={activePresetId === preset.id}
					onSelectPreset={onSelectPreset}
				/>
			))}
		</div>
	);
}

function PresetButton({
	preset,
	selected,
	onSelectPreset,
}: {
	preset: (typeof CAPINSTA_CAPTION_PRESETS)[number];
	selected: boolean;
	onSelectPreset: (presetId: CapinstaCaptionPresetId) => void;
}) {
	const preview = styleToPreview({
		style: preset.style,
		viewport: { width: 240, height: 135 },
	});
	return (
		<button
			type="button"
			onClick={() => onSelectPreset(preset.id)}
			className={cn(
				"rounded-sm border p-2 text-left text-xs transition-colors",
				selected ? "border-primary bg-primary/10" : "hover:bg-accent",
			)}
		>
			<div
				className="mb-2 flex h-14 items-center justify-center overflow-hidden rounded-sm bg-black px-2"
				style={{
					boxShadow: selected ? "inset 0 0 0 1px var(--primary)" : undefined,
				}}
			>
				<span
					style={{
						...preview.backgroundStyle,
						...preview.textStyle,
						fontSize: 12,
						WebkitTextStroke:
							preset.style.outline.width > 0
								? `${Math.min(1.5, preset.style.outline.width)}px ${preset.style.outline.color}`
								: undefined,
					}}
				>
					<span>Cap</span>{" "}
					<span style={preview.activeWordStyle}>style</span>
				</span>
			</div>
			<div className="font-medium">{preset.name}</div>
			<div className="text-muted-foreground mt-1 line-clamp-2 text-[10px]">
				{preset.description}
			</div>
		</button>
	);
}
