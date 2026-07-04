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
						"group size-7 shrink-0 border border-transparent bg-transparent text-[var(--editor-muted)] shadow-none hover:border-[var(--editor-border)] hover:bg-[var(--editor-surface-raised)] hover:text-[var(--editor-text)] focus-visible:border-[var(--editor-focus)] focus-visible:ring-0",
						className,
					)}
					onMouseDown={stopEditorPointerHandling}
					onClick={stopEditorPointerHandling}
				>
					<CircleHelp className="size-3.5 opacity-55 transition-opacity group-hover:opacity-95 group-focus-visible:opacity-95" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				sideOffset={8}
				className="z-[120] w-72 rounded-[var(--editor-radius)] border border-[var(--editor-border-strong)] bg-[var(--editor-popover)] text-[var(--editor-text)] opacity-100 shadow-[3px_3px_0_var(--editor-shadow)]"
			>
				<div className="space-y-2">
					<h3 className="text-sm font-black">{title}</h3>
					<p className="text-sm leading-5 text-[var(--editor-muted)]">
						{description}
					</p>
				</div>
			</PopoverContent>
		</Popover>
	);
}
