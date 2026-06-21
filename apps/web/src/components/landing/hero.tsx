import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/site/brand";
import {
	CreatorMediaCard,
	type MarketingMediaDefinition,
} from "./creator-media-card";

const media: MarketingMediaDefinition[] = [
	{
		poster: "/marketing/creator-vertical.webp",
		alt: "Creator recording a vertical video in a purple-lit studio",
		aspectRatio: "9/16",
		caption: "Make every word hit",
		accent: "lime",
	},
	{
		poster: "/marketing/creator-landscape.webp",
		alt: "Two video creators reviewing an edit together",
		aspectRatio: "16/9",
		caption: "Edit captions together",
		accent: "purple",
	},
	{
		poster: "/marketing/creator-square.webp",
		alt: "Creator speaking to camera in a home studio",
		aspectRatio: "1/1",
		caption: "Your voice, styled",
		accent: "pink",
	},
	{
		poster: "/marketing/creator-vertical.webp",
		alt: "Vertical creator video with animated caption styling",
		aspectRatio: "9/16",
		caption: "Ready for reels",
		accent: "purple",
	},
];

export function Hero() {
	return (
		<section className="relative min-h-[calc(100svh-4rem)] overflow-hidden border-b-2 border-black bg-[var(--cap-paper)]">
			<div className="pointer-events-none absolute inset-0 opacity-25 [background-image:linear-gradient(#750beb_1px,transparent_1px),linear-gradient(90deg,#750beb_1px,transparent_1px)] [background-size:42px_42px]" />
			<div className="relative mx-auto grid min-h-[calc(100svh-4rem)] max-w-[1500px] items-center gap-12 px-4 py-12 sm:px-6 lg:grid-cols-[0.86fr_1.14fr] lg:px-8 lg:py-16">
				<div className="relative z-10">
					<div className="inline-flex rotate-[-1deg] items-center gap-2 border-2 border-black bg-[var(--cap-lime)] px-3 py-2 text-sm font-black uppercase text-[#111] shadow-[3px_3px_0_#111]">
						<Sparkles className="size-4" aria-hidden />
						Browser-based caption studio
					</div>
					<h1 className="mt-7 max-w-3xl text-[clamp(3.2rem,7vw,7.5rem)] font-black leading-[0.82] tracking-[-0.055em] text-[var(--cap-outline)]">
						Turn any video into{" "}
						<span className="text-[var(--cap-purple-600)]">animated captions.</span>
					</h1>
					<p className="mt-7 max-w-xl text-lg font-semibold leading-relaxed text-muted-foreground sm:text-xl">
						Generate, style, and fine-tune word-timed captions in your browser.
					</p>
					<div className="mt-8 flex flex-col gap-4 sm:flex-row">
						<Button asChild variant="lime" size="lg" className="h-14 px-7 text-base font-black">
							<Link href={ROUTES.projects}>
								Caption a video free <ArrowRight />
							</Link>
						</Button>
						<Button asChild variant="brutal" size="lg" className="h-14 px-7 text-base font-black">
							<Link href="#caption-styles">See caption styles</Link>
						</Button>
					</div>
					<p className="mt-5 text-sm font-bold text-muted-foreground">
						Currently free during public beta.
					</p>
				</div>

				<div className="min-w-0">
					<div className="hidden grid-cols-[0.72fr_1.45fr_0.72fr] items-center gap-4 md:grid">
						<CreatorMediaCard media={media[0]} className="rotate-[-2deg]" priority />
						<div className="grid gap-4">
							<CreatorMediaCard media={media[1]} priority />
							<CreatorMediaCard media={media[2]} className="mx-auto w-[56%] rotate-[1deg]" />
						</div>
						<CreatorMediaCard media={media[3]} className="rotate-[2deg]" />
					</div>
					<div className="md:hidden">
						<CreatorMediaCard media={media[0]} className="mx-auto w-[72%] max-w-sm" priority />
						<div className="scrollbar-hidden -mx-4 mt-5 flex snap-x gap-4 overflow-x-auto px-4 pb-3">
							{media.slice(1).map((item) => (
								<CreatorMediaCard
									key={item.caption}
									media={item}
									className="w-[72vw] shrink-0 snap-center"
								/>
							))}
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
