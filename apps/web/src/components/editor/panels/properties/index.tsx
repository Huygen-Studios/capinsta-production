"use client";

import { useEffect, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEditor } from "@/editor/use-editor";
import { useElementSelection } from "@/timeline/hooks/element/use-element-selection";
import { getPropertiesConfig } from "./registry";
import { findCapinstaBindingForElement } from "@/capinsta/captionTimelineSync";
import { getSelectedCapinstaCaptionRefs } from "@/capinsta/bulkStyleSync";
import { CapinstaCaptionStylePanel } from "@/capinsta/components/CapinstaCaptionStylePanel";
import {
	EffectControlsEmptyState,
	EffectControlsPanel,
	EffectControlsShell,
} from "./effect-controls-panel";
import { CaptionEditorPanel } from "@/subtitles/components/caption-editor-panel";
import { cn } from "@/utils/ui";

type CaptionPanelTab = "effects" | "editor";

const CAPTION_INSPECTOR_TABS: ReadonlyArray<{
	tab: CaptionPanelTab;
	label: string;
}> = [
	{ tab: "effects", label: "Effect Controls" },
	{ tab: "editor", label: "Caption Editor" },
];

function CaptionInspectorTabs({
	activeTab,
	onChange,
}: {
	activeTab: CaptionPanelTab;
	onChange: (tab: CaptionPanelTab) => void;
}) {
	return (
		<div className="flex shrink-0 gap-1 border-b border-border bg-card px-2 py-2">
			{CAPTION_INSPECTOR_TABS.map(({ tab, label }) => (
				<button
					key={tab}
					type="button"
					className={cn(
						"rounded-sm border px-2 py-1 text-xs font-bold",
						activeTab === tab
							? "border-[var(--neo-black)] bg-primary text-primary-foreground shadow-[2px_2px_0_var(--shadow-strong)]"
							: "border-border bg-background text-muted-foreground hover:bg-muted",
					)}
					onClick={() => onChange(tab)}
				>
					{label}
				</button>
			))}
		</div>
	);
}

export function PropertiesPanel() {
	const editor = useEditor();
	useEditor((e) => e.scenes.getActiveSceneOrNull());
	useEditor((e) => e.media.getAssets());
	useEditor((e) => e.project.getActive()?.capinstaCaptionDocuments);
	const { selectedElements, elementSelectionMode } = useElementSelection();
	const [captionTab, setCaptionTab] = useState<CaptionPanelTab>("effects");

	useEffect(() => {
		const frame = requestAnimationFrame(() => {
			setCaptionTab(
				elementSelectionMode === "individual" ? "editor" : "effects",
			);
		});
		return () => cancelAnimationFrame(frame);
	}, [elementSelectionMode]);

	if (selectedElements.length === 0) {
		return <EffectControlsEmptyState />;
	}

	if (selectedElements.length > 1) {
		const activeScene = editor.scenes.getActiveSceneOrNull();
		const records = editor.project.getActive()?.capinstaCaptionDocuments ?? [];
		const { selectedCapinstaClipRefs, ignoredCount } = activeScene
			? getSelectedCapinstaCaptionRefs({
					selection: selectedElements,
					tracks: activeScene.tracks,
					records,
				})
			: { selectedCapinstaClipRefs: [], ignoredCount: selectedElements.length };

		if (selectedCapinstaClipRefs.length > 0) {
			const editorRecord = selectedCapinstaClipRefs[0]?.record ?? null;
			return (
				<EffectControlsShell>
					<CaptionInspectorTabs
						activeTab={captionTab}
						onChange={setCaptionTab}
					/>
					{captionTab === "effects" ? (
						<ScrollArea className="min-h-0 flex-1 scrollbar-hidden">
							<CapinstaCaptionStylePanel
								mode="bulk"
								selectedCapinstaClipRefs={selectedCapinstaClipRefs}
								selectedCount={selectedCapinstaClipRefs.length}
								ignoredCount={ignoredCount}
							/>
						</ScrollArea>
					) : (
						<CaptionEditorPanel record={editorRecord} />
					)}
				</EffectControlsShell>
			);
		}

		return (
			<EffectControlsShell>
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 text-center">
					<p className="text-muted-foreground text-sm">
						{selectedElements.length} elements selected
					</p>
				</div>
			</EffectControlsShell>
		);
	}

	const mediaAssets = editor.media.getAssets();

	const elementsWithTracks = editor.timeline.getElementsWithTracks({
		elements: selectedElements,
	});
	const elementWithTrack = elementsWithTracks[0];

	if (!elementWithTrack) return null;

	const { element, track } = elementWithTrack;
	const capinstaBinding = findCapinstaBindingForElement({
		records: editor.project.getActive()?.capinstaCaptionDocuments ?? [],
		tracks: editor.scenes.getActiveScene().tracks,
		element,
	});
	const config = getPropertiesConfig({ element, mediaAssets, capinstaBinding });
	const visibleTabs = config.tabs;
	if (visibleTabs.length === 0) return <EffectControlsEmptyState />;

	const captionStatus = capinstaBinding ? (
		<div className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-2 text-xs">
			<span className="font-medium">Capinsta caption</span>
			{capinstaBinding.clip.timingNeedsReview ? (
				<span className="text-amber-500" title="Rebuild caption timing later">
					Timing needs review
				</span>
			) : (
				<span className="text-muted-foreground">Word timing linked</span>
			)}
		</div>
	) : undefined;

	if (capinstaBinding) {
		return (
			<EffectControlsShell>
				<CaptionInspectorTabs activeTab={captionTab} onChange={setCaptionTab} />
				{captionStatus}
				{captionTab === "effects" ? (
					<ScrollArea className="min-h-0 flex-1 scrollbar-hidden">
						<CapinstaCaptionStylePanel
							binding={capinstaBinding}
							trackId={track.id}
						/>
					</ScrollArea>
				) : (
					<CaptionEditorPanel record={capinstaBinding.record} />
				)}
			</EffectControlsShell>
		);
	}

	return (
		<EffectControlsPanel
			tabs={visibleTabs}
			trackId={track.id}
			element={element}
			captionStatus={captionStatus}
		/>
	);
}
