import * as React from "react";

import { cn } from "@/utils/ui";

const Textarea = React.forwardRef<
	HTMLTextAreaElement,
	React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
	return (
		<textarea
			className={cn(
				"file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground border-border bg-input flex min-h-[60px] w-full rounded-none border-2 px-3 py-2 resize-none text-base shadow-[2px_2px_0_var(--cap-shadow-color)] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none md:text-sm",
				"focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/25",
				"aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
				className,
			)}
			ref={ref}
			{...props}
		/>
	);
});
Textarea.displayName = "Textarea";

export { Textarea };
