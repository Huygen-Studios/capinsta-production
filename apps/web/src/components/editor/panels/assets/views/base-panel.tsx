import { cn } from "@/utils/ui";

interface PanelViewProps extends React.HTMLAttributes<HTMLDivElement> {
	title?: string;
	actions?: React.ReactNode;
	children: React.ReactNode;
	contentClassName?: string;
	scrollClassName?: string;
	hideHeader?: boolean;
	ref?: React.Ref<HTMLDivElement>;
	onScroll?: React.UIEventHandler<HTMLDivElement>;
	scrollRef?: React.Ref<HTMLDivElement>;
}

export function PanelView({
	title,
	actions,
	children,
	className,
	contentClassName,
	scrollClassName,
	hideHeader = false,
	ref,
	onScroll,
	scrollRef,
	...rest
}: PanelViewProps) {
	return (
		<div
			className={cn("relative flex h-full flex-col", className)}
			ref={ref}
			{...rest}
		>
			{!hideHeader && (
				<div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-[var(--editor-border-subtle)] bg-[var(--editor-surface)] pl-3 pr-2">
					{title && (
						<span className="min-w-0 truncate text-sm font-semibold text-foreground">
							{title}
						</span>
					)}
					<div className="flex shrink-0 items-center">{actions}</div>
				</div>
			)}
			<div
				className={cn(
					"scrollbar-hidden size-full overflow-y-auto",
					hideHeader ? "pt-4" : "pt-2",
					scrollClassName,
				)}
				ref={scrollRef}
				onScroll={onScroll}
			>
				<div className={cn("w-full flex-1 px-2 pt-0", contentClassName)}>
					{children}
				</div>
			</div>
		</div>
	);
}
