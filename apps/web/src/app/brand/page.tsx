import type { Metadata } from "next";
import Image from "next/image";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { BRAND } from "@/site/brand";

export const metadata: Metadata = {
	title: "Capinsta brand assets",
	description: "Approved Capinsta logos, product descriptions, attribution, contact details, and product screenshots.",
	alternates: { canonical: "/brand" },
};

const downloads = [
	{ name: "Capinsta transparent logo", href: "/logos/capinsta/capinsta-logo.png" },
	{ name: "Capinsta solid logo", href: "/logos/capinsta/capinsta-logo-solid.png" },
	{ name: "Capinsta wordmark", href: "/logos/capinsta/logo.png" },
	{ name: "Capinsta symbol", href: "/logos/capinsta/symbol.png" },
];

export default function BrandPage() {
	return <div className="marketing-theme"><Header /><main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
		<h1 className="text-5xl font-black sm:text-7xl">Capinsta brand assets.</h1>
		<p className="mt-5 max-w-3xl text-xl text-muted-foreground">Approved files and factual product language for press, partners, and editorial coverage.</p>
		<section className="mt-12 grid gap-6 md:grid-cols-2">
			<div className="cap-brutal-card grid min-h-72 place-items-center bg-[var(--cap-purple-600)] p-10"><Image src="/logos/capinsta/capinsta-logo.png" alt="Capinsta logo" width={520} height={220} className="h-auto max-h-52 w-auto object-contain" /></div>
			<div className="cap-brutal-card p-7"><h2 className="text-2xl font-black">Approved downloads</h2><ul className="mt-5 space-y-3">{downloads.map((asset) => <li key={asset.href}><a href={asset.href} download className="font-black text-[var(--cap-purple-600)] underline">{asset.name} ↓</a></li>)}</ul></div>
		</section>
		<section className="mt-10 cap-brutal-card p-7"><h2 className="text-2xl font-black">Product description</h2><p className="mt-4 text-lg leading-relaxed">Capinsta is a browser-based caption studio for generating, timing, styling, and exporting animated video captions. It is currently free during public beta.</p><p className="mt-4 font-semibold">Capinsta is a product by {BRAND.parentCompany}. Press and brand questions: <a href={`mailto:${BRAND.supportEmail}`} className="underline">{BRAND.supportEmail}</a>.</p></section>
		<section className="mt-10"><h2 className="text-3xl font-black">Product screenshot</h2><div className="mt-5 overflow-hidden rounded-xl border-2 border-black shadow-[5px_5px_0_#111]"><Image src="/brand/editor-screenshot.webp" alt="Capinsta browser video editor with preview, properties panel, and timeline" width={1400} height={590} className="h-auto w-full" /></div></section>
	</main><Footer /></div>;
}
