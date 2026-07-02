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
				"group relative min-w-0 overflow-hidden rounded-sm border border-[var(--neo-black)] bg-[var(--neo-black)] shadow-[3px_3px_0_var(--cap-shadow-color)] transition-transform duration-200 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[5px_5px_0_var(--cap-shadow-color)]",
				className,
			)}
		>
			<div className={cn("relative overflow-hidden bg-background", aspectClasses[media.aspectRatio])}>
				{media.webm || media.mp4 ? (
					<video
						className="h-full w-full object-cover"
						poster={media.poster}
						autoPlay
						muted
						playsInline
						loop
						preload="metadata"
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
			</div>
			<div className="border-t border-[var(--neo-black)] bg-[var(--neo-black)] px-2 py-2 text-center">
				<span
					className={cn(
						"inline-block max-w-full rotate-[-1deg] border border-foreground px-3 py-1.5 text-base font-black uppercase leading-none shadow-[2px_2px_0_rgba(255,255,255,0.85)] sm:text-lg",
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
