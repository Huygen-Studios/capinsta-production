import Image from "next/image";
import { cn } from "@/utils/ui";

export interface MarketingMediaDefinition {
	poster: string;
	alt: string;
	aspectRatio: "9/16" | "16/9" | "1/1";
	webm?: string;
	mp4?: string;
	caption: string;
	accent?: "lime" | "purple" | "pink";
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
				"cap-brutal-card group relative min-w-0 overflow-hidden bg-black transition-transform duration-200 hover:-translate-y-1 hover:shadow-[7px_7px_0_#111]",
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
						"inline-block max-w-full rotate-[-1deg] border-2 border-black px-3 py-1.5 text-base font-black uppercase leading-none shadow-[3px_3px_0_#111] sm:text-lg",
						media.accent === "purple" && "bg-[var(--cap-purple-400)] text-white",
						media.accent === "pink" && "bg-[var(--cap-pink)] text-black",
						(!media.accent || media.accent === "lime") &&
							"bg-[var(--cap-lime)] text-black",
					)}
				>
					{media.caption}
				</span>
			</div>
		</figure>
	);
}
