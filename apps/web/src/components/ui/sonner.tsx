"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
	const { theme = "system" } = useTheme();
	const resolvedTheme: ToasterProps["theme"] =
		theme === "dark" || theme === "light" || theme === "system"
			? theme
			: "system";

	return (
		<Sonner
			theme={resolvedTheme}
			className="toaster group"
			position="bottom-right"
			offset={20}
			toastOptions={{
				classNames: {
					toast:
						"group toast group-[.toaster]:rounded-sm group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-[3px_3px_0_#000]",
					description: "group-[.toast]:text-muted-foreground",
					actionButton:
						"group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
					cancelButton:
						"group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
				},
			}}
			expand={false}
			richColors
			{...props}
		/>
	);
};

export { Toaster };
