"use client";

import * as React from "react";
import { Switch as SwitchPrimitives } from "radix-ui";

import { cn } from "@/utils/ui";

const Switch = React.forwardRef<
	React.ElementRef<typeof SwitchPrimitives.Root>,
	React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
	<SwitchPrimitives.Root
		className={cn(
			"peer focus-visible:ring-ring focus-visible:ring-offset-background data-[state=checked]:border-[var(--neo-black)] data-[state=checked]:bg-primary data-[state=unchecked]:border-border data-[state=unchecked]:bg-muted inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border shadow-xs transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
			className,
		)}
		{...props}
		ref={ref}
	>
		<SwitchPrimitives.Thumb
			className={cn(
				"pointer-events-none block size-4 rounded-full border border-[var(--neo-black)] bg-background shadow-[1px_1px_0_var(--cap-shadow-color)] ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0",
			)}
		/>
	</SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
