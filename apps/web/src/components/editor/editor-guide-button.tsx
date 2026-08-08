"use client";

import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useEditorGuide } from "./editor-onboarding";

export function EditorGuideButton() {
	const { startEditorTour } = useEditorGuide();

	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="outline"
						size="sm"
						data-tour="guide-me"
						aria-label="Start editor guide"
						onClick={() => startEditorTour({ source: "manual" })}
						className="h-8 gap-1.5 border-[var(--editor-border)] bg-[var(--editor-surface-raised)] px-3 text-[13px] font-semibold text-[var(--editor-text)] shadow-none hover:bg-[var(--editor-surface)] hover:text-[var(--editor-text)]"
					>
						<Compass className="size-3.5" />
						<span className="hidden sm:inline">Guide me</span>
					</Button>
				</TooltipTrigger>
				<TooltipContent>Start editor guide</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}
