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
						className="h-9"
					>
						<Compass className="size-4" />
						<span className="hidden sm:inline">Guide me</span>
					</Button>
				</TooltipTrigger>
				<TooltipContent>Start editor guide</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}
