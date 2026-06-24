import Image from "next/image";
import { cn } from "@/utils/ui";

export interface MarketingMediaDefinition {
	poster: string;
	alt: string;
	aspectRatio: "9/16" | "16/9" | "1/1";
	webm?: string;
	mp4?: string;
	caption: string;
	accent?: "lime" | "pink" | "blue" | "teal" | "yellow";
}

const aspectClasses = {
	"9/16": "aspect-[9/16]",
	"16/9": "aspect-video",
	"1/1": "aspect-square",
};

export function CreatorMediaCard({
	media,
	className,
	priority = false,
}: {
	media: MarketingMediaDefinition;
	className?: string;
	priority?: boolean;
}) {
	return (
		<figure
			className={cn(
				"cap-brutal-card group relative min-w-0 overflow-hidden bg-background transition-transform duration-200 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[7px_7px_0_var(--cap-shadow-color)]",
				aspectClasses[media.aspectRatio],
				className,
			)}
		>
			{media.webm || media.mp4 ? (
				<video
					className="h-full w-full object-cover"
					poster={media.poster}
					muted
					playsInline
					loop
					preload="none"
					aria-label={media.alt}
				>
					{media.webm && <source src={media.webm} type="video/webm" />}
					{media.mp4 && <source src={media.mp4} type="video/mp4" />}
				</video>
			) : (
				<Image
					src={media.poster}
					alt={media.alt}
					fill
					priority={priority}
					sizes="(max-width: 640px) 82vw, (max-width: 1024px) 42vw, 34vw"
					className="object-cover"
				/>
			)}
			<div className="absolute inset-x-3 bottom-3 text-center">
				<span
					className={cn(
						"inline-block max-w-full rotate-[-1deg] border-2 border-foreground px-3 py-1.5 text-base font-black uppercase leading-none shadow-[3px_3px_0_var(--cap-shadow-color)] sm:text-lg",
						media.accent === "blue" && "bg-[var(--neo-blue)] text-[var(--neo-black)]",
						media.accent === "teal" && "bg-[var(--neo-teal)] text-[var(--neo-black)]",
						media.accent === "yellow" && "bg-[var(--neo-yellow)] text-[var(--neo-black)]",
						media.accent === "pink" && "bg-[var(--neo-pink)] text-[var(--neo-black)]",
						(!media.accent || media.accent === "lime") &&
							"bg-primary text-primary-foreground",
					)}
				>
					{media.caption}
				</span>
			</div>
		</figure>
	);
}
