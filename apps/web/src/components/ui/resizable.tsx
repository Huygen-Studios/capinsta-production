"use client";

import * as ResizablePrimitive from "react-resizable-panels";

import { cn } from "@/utils/ui";

const ResizablePanelGroup = ({
	className,
	...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) => (
	<ResizablePrimitive.PanelGroup
		className={cn(
			"flex size-full data-[panel-group-direction=vertical]:flex-col",
			className,
		)}
		{...props}
	/>
);

const ResizablePanel = ResizablePrimitive.Panel;

const ResizableHandle = ({
	withHandle,
	className,
	...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
	withHandle?: boolean;
}) => (
	<ResizablePrimitive.PanelResizeHandle
		className={cn(
			"focus-visible:ring-ring relative flex w-2 items-center justify-center bg-transparent after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border hover:after:bg-primary focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:outline-hidden data-[panel-group-direction=vertical]:h-2 data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-px data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:translate-x-0 data-[panel-group-direction=vertical]:after:-translate-y-1/2 [&[data-panel-group-direction=vertical]>div]:rotate-90",
			className,
		)}
		{...props}
	/>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
