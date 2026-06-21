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
			{ url: "/favicon.ico", sizes: "any" },
			{ url: "/logos/favicon/favicon.ico", sizes: "any" },
			{
				url: "/logos/favicon/favicon-16x16.png",
				sizes: "16x16",
				type: "image/png",
			},
			{
				url: "/logos/favicon/favicon-32x32.png",
				sizes: "32x32",
				type: "image/png",
			},
		],
		apple: [
			{
				url: "/logos/favicon/apple-touch-icon.png",
				sizes: "180x180",
				type: "image/png",
			},
		],
		shortcut: ["/logos/favicon/favicon.ico"],
	},
	appleWebApp: {
		capable: true,
		statusBarStyle: "black-translucent",
		title: BRAND.productName,
	},
	manifest: "/logos/favicon/site.webmanifest",
};

/** Theme color + viewport. Exported separately (Next 16 viewport API). */
export const viewportTheme: Viewport = {
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "#750beb" },
		{ media: "(prefers-color-scheme: dark)", color: "#16015d" },
	],
	colorScheme: "light dark",
};
