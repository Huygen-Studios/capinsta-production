"use client";

import type { ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Section,
	SectionContent,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import type { PropertiesTabDef } from "./registry";
import type { TimelineElement } from "@/timeline";
import { useEditor } from "@/editor/use-editor";
import { cn } from "@/utils/ui";
import { EditorHelpButton } from "@/components/editor/editor-help-button";
import { EDITOR_HELP_CONTENT } from "@/components/editor/editor-help-content";

const VISUAL_TYPES = new Set(["video", "image", "text", "sticker", "graphic"]);

function sectionLabel(label: string): string {
	if (label === "Transform") return "Motion";
	if (label === "Blending") return "Opacity & Blending";
	if (label === "Audio") return "Audio";
	if (label === "Caption Style") return "Caption Style";
	if (label === "Edit captions") return "Caption Animation";
	return label;
}

function sectionOrder(label: string): number {
	switch (sectionLabel(label)) {
		case "Motion":
			return 10;
		case "Opacity & Blending":
			return 20;
		case "Audio":
			return 30;
		case "Text":
			return 40;
		case "Caption Style":
			return 50;
		case "Caption Animation":
			return 60;
		default:
			return 100;
	}
}

function canReset(label: string): boolean {
	return ["Motion", "Opacity & Blending", "Audio"].includes(sectionLabel(label));
}

function resetPatchForSection({
	label,
	element,
}: {
	label: string;
	element: TimelineElement;
}): Partial<TimelineElement> | null {
	const name = sectionLabel(label);
	if (name === "Motion" && VISUAL_TYPES.has(element.type)) {
		return {
			params: {
				...element.params,
				"transform.positionX": 0,
				"transform.positionY": 0,
				"transform.scaleX": 1,
				"transform.scaleY": 1,
				"transform.rotate": 0,
			},
		};
	}
	if (name === "Opacity & Blending" && VISUAL_TYPES.has(element.type)) {
		return {
			params: {
				...element.params,
				opacity: 1,
				blendMode: "normal",
			},
		};
	}
	if (name === "Audio" && (element.type === "audio" || element.type === "video")) {
		return {
			params: {
				...element.params,
				muted: false,
				volume: 0,
			},
		};
	}
	return null;
}

function EffectSection({
	tab,
	trackId,
	element,
}: {
	tab: PropertiesTabDef;
	trackId: string;
	element: TimelineElement;
}) {
	const editor = useEditor();
	const label = sectionLabel(tab.label);
	const resetPatch = resetPatchForSection({ label: tab.label, element });
	const reset = (event: React.MouseEvent<HTMLButtonElement>) => {
		event.stopPropagation();
		if (!resetPatch) return;
		editor.timeline.updateElements({
			updates: [{ trackId, elementId: element.id, patch: resetPatch }],
		});
	};

	return (
		<Section
			collapsible
			defaultOpen={sectionOrder(tab.label) < 70}
			sectionKey={`effect-controls:${element.type}:${tab.id}`}
			showTopBorder
			showBottomBorder={false}
			className="border-border/80"
		>
			<SectionHeader
				className="h-9 px-3 text-xs"
				leading={<span className="text-muted-foreground text-[11px] italic">fx</span>}
				trailing={
					canReset(tab.label) ? (
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="size-6"
							aria-label={`Reset ${label}`}
							title={`Reset ${label}`}
							disabled={!resetPatch}
							onClick={reset}
						>
							<RotateCcw className="size-3.5" />
						</Button>
					) : null
				}
			>
				<SectionTitle className="text-xs font-semibold">{label}</SectionTitle>
			</SectionHeader>
			<SectionContent className="px-3 pb-4 pt-1.5">
				<div className="effect-controls-section text-sm">
					{tab.content({ trackId })}
				</div>
			</SectionContent>
		</Section>
	);
}

export function EffectControlsShell({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"panel editor-panel flex h-full min-h-0 flex-col overflow-hidden",
				className,
			)}
			data-tour="properties-panel"
		>
			<div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b border-border bg-card px-3 py-2.5">
				<h2 className="text-sm font-black tracking-wide">Effect Controls</h2>
				<EditorHelpButton
					title={EDITOR_HELP_CONTENT.properties.title}
					description={EDITOR_HELP_CONTENT.properties.description}
				/>
			</div>
			{children}
		</div>
	);
}

export function EffectControlsEmptyState() {
	return (
		<EffectControlsShell>
			<div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 text-center">
				<p className="text-sm text-muted-foreground">Select a layer to edit its properties.</p>
			</div>
		</EffectControlsShell>
	);
}

export function EffectControlsPanel({
	tabs,
	trackId,
	element,
	captionStatus,
}: {
	tabs: PropertiesTabDef[];
	trackId: string;
	element: TimelineElement;
	captionStatus?: ReactNode;
}) {
	const orderedTabs = [...tabs].sort((left, right) => sectionOrder(left.label) - sectionOrder(right.label));
	return (
		<EffectControlsShell>
			{captionStatus}
			<div className="min-h-0 flex-1 overflow-y-auto scrollbar-hidden">
				{orderedTabs.map((tab) => (
					<EffectSection
						key={tab.id}
						tab={tab}
						trackId={trackId}
						element={element}
					/>
				))}
			</div>
		</EffectControlsShell>
	);
}
