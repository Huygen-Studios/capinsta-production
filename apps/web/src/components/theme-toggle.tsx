"use client";

import { Button } from "./ui/button";
import { useTheme } from "next-themes";
import { cn } from "@/utils/ui";
import { Sun03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

interface ThemeToggleProps {
	className?: string;
	iconClassName?: string;
	onToggle?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

export function ThemeToggle({
	className,
	iconClassName,
	onToggle,
}: ThemeToggleProps) {
	const { resolvedTheme, setTheme } = useTheme();

	return (
		<Button
			size="icon"
			variant="ghost"
			className={cn("size-8", className)}
			onClick={(e) => {
				const nextTheme = resolvedTheme === "dark" ? "light" : "dark";
				setTheme(nextTheme);
				document.documentElement.classList.remove("light", "dark");
				document.documentElement.classList.add(nextTheme);
				document.documentElement.style.colorScheme = nextTheme;
				try {
					localStorage.setItem("theme", nextTheme);
				} catch {
					// next-themes still applies the in-memory preference.
				}
				onToggle?.(e);
			}}
			aria-label={`Use ${resolvedTheme === "dark" ? "light" : "dark"} theme`}
		>
			<HugeiconsIcon
				icon={Sun03Icon}
				className={cn("!size-[1.1rem]", iconClassName)}
			/>
		</Button>
	);
}
