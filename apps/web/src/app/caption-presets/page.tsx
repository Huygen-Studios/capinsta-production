import type { Metadata } from "next";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { PresetShowcase } from "@/components/landing/preset-showcase";

export const metadata: Metadata = {
	title: "Animated caption presets",
	description: "Explore Capinsta's public animated caption presets, including active-word, cinematic, kinetic, and editorial styles.",
	alternates: { canonical: "/caption-presets" },
};

export default function CaptionPresetsPage() {
	return <div className="marketing-theme"><Header /><main><section className="mx-auto max-w-7xl px-4 py-16 sm:px-6"><p className="font-black uppercase tracking-[.18em] text-[var(--cap-purple-600)]">Caption preset gallery</p><h1 className="mt-4 max-w-4xl text-5xl font-black leading-[.9] tracking-tight sm:text-7xl">Start with a style. Keep every control.</h1><p className="mt-6 max-w-2xl text-xl text-muted-foreground">These previews are driven by the same canonical preset registry used by the editor. New public presets appear here automatically.</p></section><PresetShowcase compact /></main><Footer /></div>;
}
