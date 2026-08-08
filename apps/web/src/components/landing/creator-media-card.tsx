"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import Skeleton from "react-loading-skeleton";
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

const SKELETON_BASE_COLOR = "#161616";
const SKELETON_HIGHLIGHT_COLOR = "#242424";

type MediaStatus = "loading" | "ready" | "error";

function VideoPreview({
	webm,
	mp4,
	alt,
}: {
	webm?: string;
	mp4?: string;
	alt: string;
}) {
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const [mediaStatus, setMediaStatus] = useState<MediaStatus>("loading");
	const isVideoReady = mediaStatus === "ready";
	const isVideoFailed = mediaStatus === "error";

	const handleVideoRef = useCallback((node: HTMLVideoElement | null) => {
		videoRef.current = node;
		if (node && node.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
			setMediaStatus("ready");
		}
	}, []);

	const handleLoadedData = () => {
		setMediaStatus("ready");
	};

	const handleVideoError = () => {
		setMediaStatus("error");
	};

	useEffect(() => {
		if (mediaStatus !== "loading") return;
		const fallbackErrorTimeout = window.setTimeout(() => {
			setMediaStatus((currentStatus) =>
				currentStatus === "loading" ? "error" : currentStatus,
			);
		}, 8000);

		return () => {
			window.clearTimeout(fallbackErrorTimeout);
		};
	}, [mediaStatus]);

	return (
		<>
			<video
				ref={handleVideoRef}
				className={cn(
					"h-full w-full object-cover transition-opacity duration-200 motion-reduce:transition-none",
					isVideoReady ? "opacity-100" : "opacity-0",
				)}
				autoPlay
				muted
				playsInline
				loop
				preload="metadata"
				aria-label={alt}
				onLoadedData={handleLoadedData}
				onError={handleVideoError}
			>
				{webm && <source src={webm} type="video/webm" onError={handleVideoError} />}
				{mp4 && <source src={mp4} type="video/mp4" onError={handleVideoError} />}
			</video>
			{mediaStatus === "loading" ? (
				<div
					className="pointer-events-none absolute inset-0 overflow-hidden bg-[#161616]"
					aria-hidden="true"
				>
					<Skeleton
						width="100%"
						height="100%"
						baseColor={SKELETON_BASE_COLOR}
						highlightColor={SKELETON_HIGHLIGHT_COLOR}
						borderRadius={0}
						containerClassName="block h-full w-full leading-none"
						className="block h-full w-full"
					/>
				</div>
			) : null}
			{isVideoFailed ? (
				<div
					className="pointer-events-none absolute inset-0 bg-[#151515] [background-image:linear-gradient(135deg,rgba(255,255,255,0.04)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.04)_50%,rgba(255,255,255,0.04)_75%,transparent_75%,transparent)] [background-size:18px_18px]"
					aria-hidden="true"
				/>
			) : null}
		</>
	);
}

export function CreatorMediaCard({
	media,
	className,
	priority = false,
}: {
	media: MarketingMediaDefinition;
	className?: string;
	priority?: boolean;
}) {
	const sourceKey = `${media.webm ?? ""}|${media.mp4 ?? ""}`;
	const hasVideo = Boolean(media.webm || media.mp4);

	return (
		<figure
			className={cn(
				"group relative min-w-0 overflow-hidden rounded-sm border border-[var(--neo-black)] bg-[var(--neo-black)] shadow-[3px_3px_0_var(--cap-shadow-color)] transition-transform duration-200 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[5px_5px_0_var(--cap-shadow-color)]",
				className,
			)}
		>
			<div className={cn("relative overflow-hidden bg-background", aspectClasses[media.aspectRatio])}>
				{hasVideo ? (
					<VideoPreview
						key={sourceKey}
						webm={media.webm}
						mp4={media.mp4}
						alt={media.alt}
					/>
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
