"use client";

import Image from "next/image";
import { useTheme } from "next-themes";
import { LOGOS } from "@/site/brand";
import { cn } from "@/utils/ui";

type LogoVariant = "wordmark" | "mark";

interface LogoProps {
	/** Which lockup to render. Defaults to the full wordmark. */
	variant?: LogoVariant;
	/** Pixel height. Width is derived from the asset aspect ratio. */
	height?: number;
	className?: string;
	/** Accessible alt text override. Defaults to the Capinsta product name. */
	alt?: string;
	/** Extra horizontal padding around the mark (logo breathing room). */
	priority?: boolean;
}

/**
 * Capinsta logo. Selects the correct light/dark asset for the active theme so
 * we never rely on a CSS invert hack. Falls back gracefully during SSR/first
 * paint by rendering the dark-surface (light) variant, then correcting once
 * the theme resolves on the client.
 *
 * Logos always use `object-contain` and keep transparent backgrounds.
 */
export function Logo({
	variant = "wordmark",
	height = 32,
	className,
	alt = "Capinsta",
	priority = false,
}: LogoProps) {
	const { resolvedTheme } = useTheme();
	const isDark = resolvedTheme === "dark";

	const src = variant === "mark" ? LOGOS.mark : LOGOS.wordmark;
	const srcLight = variant === "mark" ? LOGOS.markLight : LOGOS.wordmarkLight;

	// On dark surfaces use the light-on-dark asset; otherwise the dark-on-light one.
	const activeSrc = isDark ? srcLight : src;

	// Aspect ratios of the supplied masters (square mark vs ~4.5:1 wordmark).
	const aspect = variant === "mark" ? 1 : 7538 / 1667;
	const width = Math.round(height * aspect);

	return (
		<Image
			src={activeSrc}
			alt={alt}
			width={width}
			height={height}
			priority={priority}
			className={cn("object-contain select-none", className)}
			sizes={`${width}px`}
		/>
	);
}

/**
 * Theme-aware logo that also renders the correct variant for SSR by showing
 * both assets and toggling visibility via CSS. Use this only where avoiding a
 * flash before hydration matters (e.g. the landing hero).
 */
export function LogoStatic({
	variant = "wordmark",
	height = 32,
	className,
	alt = "Capinsta",
	priority = false,
}: LogoProps) {
	const src = variant === "mark" ? LOGOS.mark : LOGOS.wordmark;
	const srcLight = variant === "mark" ? LOGOS.markLight : LOGOS.wordmarkLight;
	const aspect = variant === "mark" ? 1 : 7538 / 1667;
	const width = Math.round(height * aspect);

	return (
		<>
			{/* Dark-on-light: visible on light surfaces, hidden on dark. */}
			<Image
				src={src}
				alt={alt}
				width={width}
				height={height}
				priority={priority}
				className={cn("object-contain select-none dark:hidden", className)}
				sizes={`${width}px`}
			/>
			{/* Light-on-dark: hidden on light surfaces, visible on dark. */}
			<Image
				src={srcLight}
				alt=""
				aria-hidden
				width={width}
				height={height}
				priority={priority}
				className={cn("object-contain select-none hidden dark:block", className)}
				sizes={`${width}px`}
			/>
		</>
	);
}
