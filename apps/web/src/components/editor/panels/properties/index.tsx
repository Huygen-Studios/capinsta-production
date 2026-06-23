"use client";

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

export function PropertiesPanel() {
	const editor = useEditor();
	useEditor((e) => e.scenes.getActiveSceneOrNull());
	useEditor((e) => e.media.getAssets());
	useEditor((e) => e.project.getActive()?.capinstaCaptionDocuments);
	const { selectedElements } = useElementSelection();

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
			return (
				<EffectControlsShell>
					<ScrollArea className="min-h-0 flex-1 scrollbar-hidden">
						<CapinstaCaptionStylePanel
							mode="bulk"
							selectedCapinstaClipRefs={selectedCapinstaClipRefs}
							selectedCount={selectedCapinstaClipRefs.length}
							ignoredCount={ignoredCount}
						/>
					</ScrollArea>
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
					<div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-xs">
						<span className="font-medium">Capinsta caption</span>
						{capinstaBinding.clip.timingNeedsReview ? (
							<span
								className="text-amber-500"
								title="Rebuild caption timing later"
							>
								Timing needs review
							</span>
						) : (
							<span className="text-muted-foreground">Word timing linked</span>
						)}
					</div>
	) : undefined;

	return (
		<EffectControlsPanel
			tabs={visibleTabs}
			trackId={track.id}
			element={element}
			captionStatus={captionStatus}
		/>
	);
}
