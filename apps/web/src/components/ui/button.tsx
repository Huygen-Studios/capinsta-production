import * as React from "react";
import { Slot as SlotPrimitive } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/ui";

const buttonVariants = cva(
	"inline-flex items-center cursor-pointer justify-center gap-2 whitespace-nowrap rounded-none border-2 border-border text-sm font-bold transition-[transform,box-shadow,background-color,color,border-color] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary/35 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:translate-x-0 disabled:translate-y-0 disabled:opacity-50 disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default:
					"border-border bg-primary text-primary-foreground shadow-[3px_3px_0_var(--cap-shadow-color)] hover:-translate-x-px hover:-translate-y-px hover:shadow-[4px_4px_0_var(--cap-shadow-color)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--cap-shadow-color)]",
				background: "border-border bg-background text-foreground shadow-[2px_2px_0_var(--cap-shadow-color)] hover:bg-accent hover:-translate-x-px hover:-translate-y-px",
				destructive:
					"border-border bg-destructive text-destructive-foreground shadow-[2px_2px_0_var(--cap-shadow-color)] hover:-translate-x-px hover:-translate-y-px",
				"destructive-foreground":
					"border-2 border-destructive bg-background hover:bg-destructive/15 text-destructive shadow-[2px_2px_0_var(--cap-shadow-color)]",
				caution: "text-caution hover:bg-caution/10",
				outline:
					"border-2 border-border bg-background text-foreground shadow-[2px_2px_0_var(--cap-shadow-color)] hover:border-primary hover:bg-accent hover:-translate-x-px hover:-translate-y-px",
				secondary:
					"bg-secondary text-secondary-foreground border-2 border-secondary-border shadow-[2px_2px_0_var(--cap-shadow-color)] hover:-translate-x-px hover:-translate-y-px",
				text: "border-0 bg-transparent rounded-none opacity-100 hover:opacity-75",
				ghost: "border-2 border-transparent bg-transparent text-foreground shadow-none hover:border-border hover:bg-accent",
				link: "text-primary underline-offset-4 hover:underline !p-0 !h-auto",
				brutal:
					"rounded-none border-2 border-[var(--cap-outline)] bg-[var(--cap-purple-bright)] text-white shadow-[4px_4px_0_var(--cap-shadow-color)] hover:-translate-x-px hover:-translate-y-px hover:shadow-[6px_6px_0_var(--cap-shadow-color)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-[2px_2px_0_var(--cap-shadow-color)]",
				lime:
					"rounded-none border-2 border-[var(--cap-outline)] bg-[var(--cap-purple-bright)] text-white shadow-[4px_4px_0_var(--cap-shadow-color)] hover:-translate-x-px hover:-translate-y-px hover:shadow-[6px_6px_0_var(--cap-shadow-color)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-[2px_2px_0_var(--cap-shadow-color)]",
			},
			size: {
				default: "h-9 px-4 py-2",
				sm: "h-8 p-1 px-2.5 text-sm rounded-none",
				lg: "h-10 p-5 px-6",
				icon: "size-8 rounded-none",
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
