import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/site/brand";
import {
	CreatorMediaCard,
	type MarketingMediaDefinition,
} from "./creator-media-card";

const media: MarketingMediaDefinition[] = [
	{
		poster: "/marketing/creator-vertical.webp",
		webm: "/marketing/samples/tenglish-preset-sample.webm",
		alt: "Creator recording a vertical video in a colorful studio",
		aspectRatio: "9/16",
		caption: "Make every word hit",
		accent: "lime",
	},
	{
		poster: "/marketing/creator-landscape.webp",
		webm: "/marketing/samples/editorial-effect-preset-sample.webm",
		alt: "Two video creators reviewing an edit together",
		aspectRatio: "16/9",
		caption: "Edit captions together",
		accent: "blue",
	},
	{
		poster: "/marketing/creator-square.webp",
		webm: "/marketing/samples/music-sample.webm",
		alt: "Creator speaking to camera in a home studio",
		aspectRatio: "1/1",
		caption: "Your voice, styled",
		accent: "pink",
	},
	{
		poster: "/marketing/creator-vertical.webp",
		webm: "/marketing/samples/mr-beast-style-sample.webm",
		alt: "Vertical creator video with animated caption styling",
		aspectRatio: "9/16",
		caption: "Ready for reels",
		accent: "teal",
	},
];

export function Hero() {
	return (
		<section className="relative min-h-[calc(100svh-4rem)] overflow-hidden border-b-2 border-black bg-[var(--cap-paper)]">
			<div className="pointer-events-none absolute inset-0 opacity-25 [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:42px_42px]" />
			<div className="relative mx-auto grid min-h-[calc(100svh-4rem)] max-w-[1500px] items-center gap-12 px-4 py-12 sm:px-6 lg:grid-cols-[0.86fr_1.14fr] lg:px-8 lg:py-16">
				<div className="relative z-10">
					<h1 className="mt-7 max-w-3xl text-[clamp(3rem,13vw,5rem)] font-black leading-[0.9] tracking-normal text-foreground lg:text-[clamp(4rem,6.5vw,6.8rem)]">
						Turn any video into{" "}
						<span className="text-primary [-webkit-text-stroke:1.5px_var(--neo-black)] [paint-order:stroke_fill] [text-shadow:3px_3px_0_var(--neo-black)]">
							animated captions.
						</span>
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
					<div className="scrollbar-hidden -mx-4 flex snap-x items-center gap-4 overflow-x-auto px-4 pb-3 md:mx-0 md:grid md:grid-cols-[0.72fr_1.45fr_0.72fr] md:grid-rows-[auto_auto] md:overflow-visible md:px-0 md:pb-0">
						<CreatorMediaCard
							media={media[0]}
							className="w-[68vw] max-w-[19rem] shrink-0 snap-center rotate-[-2deg] md:col-start-1 md:row-span-2 md:row-start-1 md:w-auto md:max-w-none"
							priority
						/>
						<CreatorMediaCard
							media={media[1]}
							className="w-[82vw] max-w-[32rem] shrink-0 snap-center md:col-start-2 md:row-start-1 md:w-auto md:max-w-none"
							priority
						/>
						<CreatorMediaCard
							media={media[2]}
							className="w-[68vw] max-w-[19rem] shrink-0 snap-center rotate-[1deg] md:col-start-2 md:row-start-2 md:mx-auto md:w-[56%] md:max-w-none"
						/>
						<CreatorMediaCard
							media={media[3]}
							className="w-[68vw] max-w-[19rem] shrink-0 snap-center rotate-[2deg] md:col-start-3 md:row-span-2 md:row-start-1 md:w-auto md:max-w-none"
						/>
					</div>
				</div>
			</div>
		</section>
	);
}
