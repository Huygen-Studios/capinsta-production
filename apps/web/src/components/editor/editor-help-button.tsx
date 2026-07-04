"use client";

import type { MouseEvent } from "react";
import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/utils/ui";

export function getEditorHelpButtonAriaLabel(title: string) {
	return `About ${title}`;
}

export function EditorHelpButton({
	title,
	description,
	className,
}: {
	title: string;
	description: string;
	className?: string;
}) {
	const stopEditorPointerHandling = (event: MouseEvent) => {
		event.stopPropagation();
	};

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					aria-label={getEditorHelpButtonAriaLabel(title)}
					className={cn(
						"size-7 shrink-0 border border-transparent bg-transparent text-[var(--editor-muted)] shadow-none hover:border-[var(--editor-border)] hover:bg-[var(--editor-surface-raised)] hover:text-[var(--editor-text)]",
						className,
					)}
					onMouseDown={stopEditorPointerHandling}
					onClick={stopEditorPointerHandling}
				>
					<CircleHelp className="size-4" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				className="w-72 rounded-[var(--editor-radius)] border border-[var(--editor-border)] bg-[var(--editor-surface-raised)] shadow-[3px_3px_0_rgba(184,255,28,0.24)]"
			>
				<div className="space-y-2">
					<h3 className="text-sm font-black">{title}</h3>
					<p className="text-sm leading-5 text-muted-foreground">{description}</p>
				</div>
			</PopoverContent>
		</Popover>
	);
}
