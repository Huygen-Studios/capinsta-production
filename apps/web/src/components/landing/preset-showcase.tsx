import Image from "next/image";
import Link from "next/link";
import { CAPINSTA_CAPTION_PRESETS } from "@/capinsta/styles/presetRegistry";
import { ROUTES } from "@/site/brand";

const FEATURED_IDS = [
	"word_highlight_box",
	"attention_punch",
	"apple_cinematic",
	"kinetic_fade",
	"mrbeast_style",
	"modern_minimalist_lockup",
] as const;

export function getPublicPresetOrder() {
	const featured = FEATURED_IDS.flatMap((id) => {
		const preset = CAPINSTA_CAPTION_PRESETS.find((candidate) => candidate.id === id);
		return preset ? [preset] : [];
	});
	const featuredSet = new Set(FEATURED_IDS);
	return [
		...featured,
		...CAPINSTA_CAPTION_PRESETS.filter(
			(preset) => !featuredSet.has(preset.id as (typeof FEATURED_IDS)[number]),
		),
	];
}

const posters = [
	"/marketing/creator-square.webp",
	"/marketing/creator-landscape.webp",
	"/marketing/creator-vertical.webp",
];

const previewWords = ["Make it pop", "Watch this", "Cinematic", "Smooth motion", "BIG ENERGY", "Editorial"];

export function PresetShowcase({ compact = false }: { compact?: boolean }) {
	const presets = getPublicPresetOrder();
	return (
		<section id="caption-styles" className="overflow-hidden bg-[var(--cap-purple-950)] text-white">
			<div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
				<div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
					<div>
						<p className="font-black uppercase tracking-[0.2em] text-primary">
							Real Capinsta presets
						</p>
						<h2 className="mt-3 max-w-3xl text-4xl font-black leading-[0.95] tracking-tight sm:text-5xl">
							Caption styles built to stop the scroll.
						</h2>
					</div>
					{!compact && (
						<Link
							href={ROUTES.captionPresets}
							className="cap-focus w-fit border-b-2 border-primary pb-1 font-bold text-primary"
						>
							Explore every preset →
						</Link>
					)}
				</div>

				<div className="mt-12 grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-6">
					{presets.map((preset, index) => (
						<article
							key={preset.id}
							className={`group ${index % 2 ? "lg:translate-y-8" : ""}`}
						>
							<div className="relative aspect-square overflow-hidden border-2 border-foreground bg-background shadow-[4px_4px_0_var(--cap-shadow-color)] transition-transform group-hover:-translate-x-0.5 group-hover:-translate-y-0.5">
								<Image
									src={posters[index % posters.length]}
									alt={`${preset.name} caption preset preview`}
									fill
									sizes="(max-width: 768px) 45vw, 16vw"
									className="object-cover"
								/>
								<div className="absolute inset-x-2 bottom-4 text-center">
									<span className={`preset-word preset-word-${index % 6}`}>
										{previewWords[index % previewWords.length]}
									</span>
								</div>
							</div>
							<h3 className="mt-4 text-base font-black">{preset.name}</h3>
							<p className="mt-1 text-sm leading-snug text-white/70">
								{preset.description}
							</p>
						</article>
					))}
				</div>
			</div>
		</section>
	);
}
