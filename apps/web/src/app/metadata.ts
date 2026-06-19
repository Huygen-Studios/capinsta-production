import type { Metadata, Viewport } from "next";
import { BRAND, SITE_INFO, SITE_URL } from "@/site/brand";

export const baseMetaData: Metadata = {
	metadataBase: new URL(SITE_URL),
	title: {
		default: `${BRAND.productName} — Animated captions in your browser`,
		template: `%s — ${BRAND.productName}`,
	},
	description: SITE_INFO.description,
	applicationName: BRAND.productName,
	authors: [{ name: BRAND.parentCompany, url: BRAND.companyWebsite }],
	creator: BRAND.parentCompany,
	publisher: BRAND.parentCompany,
	keywords: [
		"Capinsta",
		"captions",
		"subtitles",
		"automatic captions",
		"AI captions",
		"active word captions",
		"captioned video",
		"Hinglish captions",
		"Telgish captions",
		"caption editor",
		"video subtitles",
		"SRT export",
		"VTT export",
		"Huygen Studios",
	],
	openGraph: {
		title: `${BRAND.productName} — Animated captions in your browser`,
		description: SITE_INFO.description,
		url: SITE_URL,
		siteName: BRAND.productName,
		locale: "en_US",
		type: "website",
		images: [
			{
				url: SITE_INFO.openGraphImage,
				width: 1200,
				height: 630,
				alt: `${BRAND.productName} — ${BRAND.productByLine}`,
			},
		],
	},
	twitter: {
		card: "summary_large_image",
		title: `${BRAND.productName} — Animated captions in your browser`,
		description: SITE_INFO.description,
		images: [SITE_INFO.twitterImage],
	},
	pinterest: {
		richPin: false,
	},
	robots: {
		index: true,
		follow: true,
	},
	icons: {
		icon: [
			{ url: "/favicon.ico" },
			{ url: "/icons/favicon-16x16.png", sizes: "16x16", type: "image/png" },
			{ url: "/icons/favicon-32x32.png", sizes: "32x32", type: "image/png" },
			{ url: "/icons/favicon-96x96.png", sizes: "96x96", type: "image/png" },
		],
		apple: [
			{ url: "/icons/apple-icon-57x57.png", sizes: "57x57", type: "image/png" },
			{ url: "/icons/apple-icon-60x60.png", sizes: "60x60", type: "image/png" },
			{ url: "/icons/apple-icon-72x72.png", sizes: "72x72", type: "image/png" },
			{ url: "/icons/apple-icon-76x76.png", sizes: "76x76", type: "image/png" },
			{
				url: "/icons/apple-icon-114x114.png",
				sizes: "114x114",
				type: "image/png",
			},
			{
				url: "/icons/apple-icon-120x120.png",
				sizes: "120x120",
				type: "image/png",
			},
			{
				url: "/icons/apple-icon-144x144.png",
				sizes: "144x144",
				type: "image/png",
			},
			{
				url: "/icons/apple-icon-152x152.png",
				sizes: "152x152",
				type: "image/png",
			},
			{
				url: "/icons/apple-icon-180x180.png",
				sizes: "180x180",
				type: "image/png",
			},
		],
		shortcut: ["/favicon.ico"],
	},
	appleWebApp: {
		capable: true,
		statusBarStyle: "black-translucent",
		title: BRAND.productName,
	},
	manifest: "/manifest.json",
	other: {
		"msapplication-config": "/browserconfig.xml",
		"msapplication-TileColor": "#7c3aed",
	},
};

/** Theme color + viewport. Exported separately (Next 16 viewport API). */
export const viewportTheme: Viewport = {
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "#ffffff" },
		{ media: "(prefers-color-scheme: dark)", color: "#0b0b0f" },
	],
	colorScheme: "light dark",
};
