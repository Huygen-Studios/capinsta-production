import * as React from "react";
import { Slot as SlotPrimitive } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/ui";

const buttonVariants = cva(
	"inline-flex items-center cursor-pointer justify-center gap-2 whitespace-nowrap rounded-sm border-2 border-border text-sm font-black transition-[transform,box-shadow,background-color,color,border-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:pointer-events-none disabled:translate-x-0 disabled:translate-y-0 disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default:
					"border-[var(--neo-black)] bg-primary text-primary-foreground shadow-[3px_3px_0_var(--shadow-strong)] hover:bg-[var(--neo-yellow)]",
				background: "bg-card text-foreground shadow-[2px_2px_0_var(--shadow-strong)] hover:bg-muted",
				destructive:
					"border-[var(--neo-black)] bg-destructive text-destructive-foreground shadow-[3px_3px_0_var(--shadow-strong)] hover:bg-[color-mix(in_srgb,var(--destructive)_84%,white)]",
				"destructive-foreground":
					"border-destructive bg-card text-destructive shadow-[2px_2px_0_var(--shadow-strong)] hover:bg-destructive/10",
				caution: "border-[var(--neo-black)] bg-caution text-caution-foreground shadow-[2px_2px_0_var(--shadow-strong)] hover:bg-caution/80",
				outline:
					"bg-card text-foreground shadow-[2px_2px_0_var(--shadow-strong)] hover:bg-muted",
				secondary:
					"border-secondary-border bg-secondary text-secondary-foreground shadow-[2px_2px_0_var(--shadow-strong)] hover:bg-muted",
				text: "border-transparent bg-transparent opacity-100 shadow-none hover:border-border hover:bg-muted",
				ghost: "border-transparent bg-transparent text-foreground shadow-none hover:border-border hover:bg-muted",
				link: "text-primary underline-offset-4 hover:underline !p-0 !h-auto",
				brutal:
					"border-[var(--neo-black)] bg-primary text-primary-foreground shadow-[4px_4px_0_var(--shadow-strong)] hover:bg-[var(--neo-yellow)]",
				lime:
					"border-[var(--neo-black)] bg-primary text-primary-foreground shadow-[4px_4px_0_var(--shadow-strong)] hover:bg-[var(--neo-yellow)]",
			},
			size: {
				default: "h-9 px-4 py-2",
				sm: "h-8 p-1 px-2.5 text-sm",
				lg: "h-10 p-5 px-6",
				icon: "size-8",
				text: "p-0",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, asChild = false, ...props }, ref) => {
		const Comp = asChild ? SlotPrimitive.Slot : "button";
		const effectiveSize = size ?? (variant === "text" ? "text" : "default");
		return (
			<Comp
				className={cn(
					buttonVariants({ variant, size: effectiveSize, className }),
				)}
				ref={ref}
				type="button"
				{...props}
			/>
		);
	},
);
Button.displayName = "Button";

export { Button, buttonVariants };
