import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/utils/ui";

const badgeVariants = cva(
	"inline-flex items-center rounded-sm border-2 px-2.5 py-0.5 text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2",
	{
		variants: {
			variant: {
				default:
					"border-border bg-primary text-primary-foreground shadow-[2px_2px_0_var(--cap-shadow-color)] hover:bg-primary/80",
				secondary:
					"border-secondary-border bg-secondary text-secondary-foreground hover:bg-secondary/80",
				destructive:
					"border-border bg-destructive text-destructive-foreground shadow-[2px_2px_0_var(--cap-shadow-color)] hover:bg-destructive/80",
				outline: "border-border text-foreground",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

export interface BadgeProps
	extends React.HTMLAttributes<HTMLDivElement>,
		VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
	return (
		<div className={cn(badgeVariants({ variant }), className)} {...props} />
	);
}

export { Badge, badgeVariants };
