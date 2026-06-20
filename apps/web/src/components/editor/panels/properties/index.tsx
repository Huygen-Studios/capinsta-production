"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useEditor } from "@/editor/use-editor";
import { useElementSelection } from "@/timeline/hooks/element/use-element-selection";
import { usePropertiesStore } from "./stores/properties-store";
import { getPropertiesConfig } from "./registry";
import { cn } from "@/utils/ui";
import { EmptyView } from "./empty-view";
import { findCapinstaBindingForElement } from "@/capinsta/captionTimelineSync";
import { getSelectedCapinstaCaptionRefs } from "@/capinsta/bulkStyleSync";
import { CapinstaCaptionStylePanel } from "@/capinsta/components/CapinstaCaptionStylePanel";

export function PropertiesPanel() {
	const editor = useEditor();
	useEditor((e) => e.scenes.getActiveSceneOrNull());
	useEditor((e) => e.media.getAssets());
	useEditor((e) => e.project.getActive()?.capinstaCaptionDocuments);
	const { selectedElements } = useElementSelection();
	const { activeTabPerType, setActiveTab } = usePropertiesStore();

	if (selectedElements.length === 0) {
		return (
			<div className="panel bg-background flex h-full flex-col items-center justify-center overflow-hidden rounded-sm border">
				<EmptyView />
			</div>
		);
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
				<div className="panel bg-background flex h-full overflow-hidden rounded-sm border">
					<ScrollArea className="min-h-0 flex-1 scrollbar-hidden">
						<CapinstaCaptionStylePanel
							mode="bulk"
							selectedCapinstaClipRefs={selectedCapinstaClipRefs}
							selectedCount={selectedCapinstaClipRefs.length}
							ignoredCount={ignoredCount}
						/>
					</ScrollArea>
				</div>
			);
		}

		return (
			<div className="panel bg-background flex h-full flex-col items-center justify-center overflow-hidden rounded-sm border">
				<p className="text-muted-foreground text-sm">
					{selectedElements.length} elements selected
				</p>
			</div>
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

	const storedTabId = activeTabPerType[element.type];
	const isStoredTabVisible = visibleTabs.some((t) => t.id === storedTabId);
	const activeTabId = isStoredTabVisible ? storedTabId : config.defaultTab;
	const activeTab =
		visibleTabs.find((t) => t.id === activeTabId) ?? visibleTabs[0];

	if (!activeTab) return null;

	return (
		<div className="panel bg-background flex h-full overflow-hidden rounded-sm border">
			<TooltipProvider delayDuration={0}>
				<div className="flex shrink-0 flex-col gap-0.5 border-r p-1 scrollbar-hidden overflow-y-auto">
					{visibleTabs.map((tab) => (
						<Tooltip key={tab.id}>
							<TooltipTrigger asChild>
								<Button
									type="button"
									variant={tab.id === activeTab.id ? "secondary" : "ghost"}
									size="icon"
									onClick={() =>
										setActiveTab({
											elementType: element.type,
											tabId: tab.id,
										})
									}
									aria-label={tab.label}
									className={cn(
										"shrink-0",
										"h-8 w-8",
										tab.id !== activeTab.id && "text-muted-foreground",
									)}
								>
									{tab.icon}
								</Button>
							</TooltipTrigger>
							<TooltipContent side="right">{tab.label}</TooltipContent>
						</Tooltip>
					))}
				</div>
			</TooltipProvider>
			<div className="flex min-w-0 flex-1 flex-col">
				{capinstaBinding ? (
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
				) : null}
				{activeTab.ownsScroll ? (
					<div className="min-h-0 flex-1">
						{activeTab.content({ trackId: track.id })}
					</div>
				) : (
					<ScrollArea className="min-h-0 flex-1 scrollbar-hidden">
						{activeTab.content({ trackId: track.id })}
					</ScrollArea>
				)}
			</div>
		</div>
	);
}
