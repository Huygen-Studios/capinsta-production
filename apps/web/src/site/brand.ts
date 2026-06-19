/**
 * Centralized brand configuration for Capinsta.
 *
 * This is the single source of truth for every user-facing brand string, link,
 * logo path, and legal route used across the application. Never repeat brand
 * strings inline — import them from here instead.
 *
 * Capinsta is a product by Huygen Studios.
 */

/**
 * Canonical production site URL.
 *
 * Resolved at build/runtime from `NEXT_PUBLIC_SITE_URL` so the same code path
 * works for local development, previews, and production. Falls back to a
 * localhost default so static rendering never throws on a missing env var.
 */
export const SITE_URL: string = (
	process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
).replace(/\/$/, "");

export const BRAND = {
	/** Public product name. */
	productName: "Capinsta",
	/** Name used where legal precision matters (policies, copyright). */
	legalProductName: "Capinsta",
	/** Parent company that owns and operates Capinsta. */
	parentCompany: "Huygen Studios",
	/** Parent-company marketing website. */
	companyWebsite: "https://huygenstudios.com",
	/** Public product website (canonical origin). */
	productWebsite: SITE_URL,
	/** Support / privacy / copyright contact. */
	supportEmail: "hello@huygenstudios.com",
	/** Marketing site for the GitHub source. */
	githubUrl: "https://github.com/Huygen-Studios/capinsta-production",
	/** Optional social profiles. Omitted platforms have no real profile. */
	social: {
		github: "https://github.com/Huygen-Studios/capinsta-production",
	},
	/** Relationship line shown next to the logo in headers/footers. */
	productByLine: "A product by Huygen Studios",
} as const;

export const SITE_INFO = {
	/** Browser/PWA title suffix base. */
	title: "Capinsta",
	/** Default meta description. */
	description:
		"Create accurate, animated captions directly in your browser. Automatic caption generation, word-level timing, active-word highlighting, and full or captions-only video export — free.",
	url: SITE_URL,
	/** Open Graph / social share image. */
	openGraphImage: "/open-graph/default.png",
	twitterImage: "/open-graph/default.png",
	favicon: "/favicon.ico",
} as const;

/**
 * Short elevator pitch (≤ 1 sentence) reused in metadata, footers, and CTAs.
 */
export const SHORT_DESCRIPTION =
	"Browser-based caption studio for accurate, animated captions with active-word highlighting.";

/**
 * Longer product description for landing/about/structured data.
 */
export const FULL_DESCRIPTION =
	"Capinsta turns any video into polished, share-ready captioned clips without leaving the browser. Upload a clip, generate accurate captions automatically, fine-tune word-level timing, apply styled caption presets with active-word highlighting, and export either a full video or captions-only render. Projects are held only temporarily and removed after inactivity, so your media never lives on a server longer than it needs to.";

/**
 * Logo asset paths.
 *
 * Two surfaces exist per variant:
 *  - `mark`/`markLight` — the symbol/square mark used at small sizes
 *  - `wordmark`/`wordmarkLight` — the full lockup (symbol + wordmark)
 * The `*-light` variants are intended for dark surfaces. All logos use
 * transparent backgrounds and are displayed with `object-contain`.
 */
export const LOGOS = {
	mark: "/logos/capinsta/symbol.png",
	markLight: "/logos/capinsta/symbol-light.png",
	wordmark: "/logos/capinsta/logo.png",
	wordmarkLight: "/logos/capinsta/logo-light.png",
	icon: "/logos/capinsta/icon.png",
	/** Square favicon-grade icon (also used for PWA + OG fallback). */
	appIcon: "/logos/capinsta/icon.png",
} as const;

/**
 * Default logo shown in the app header/footer/editor. Use the full wordmark so
 * the Capinsta name is always legible without relying on CSS invert hacks.
 *
 * Choose the variant by surface theme in the component (see <Logo />).
 */
export const DEFAULT_LOGO_URL = LOGOS.wordmark;
export const DEFAULT_LOGO_URL_LIGHT = LOGOS.wordmarkLight;

/**
 * Public marketing/legal routes. Centralized so navigation and the sitemap
 * always agree.
 */
export const ROUTES = {
	home: "/",
	features: "/features",
	howItWorks: "/how-it-works",
	guides: "/guides",
	faq: "/faq",
	about: "/about",
	contact: "/contact",
	projects: "/projects",
	editor: "/editor",
	// Legal
	privacy: "/privacy",
	terms: "/terms",
	cookies: "/cookies",
	dataRetention: "/data-retention",
	acceptableUse: "/acceptable-use",
	disclaimer: "/disclaimer",
	copyright: "/copyright",
	accessibility: "/accessibility",
} as const;

/**
 * Legal/copyright footer line. Year is computed at render time.
 */
export function copyrightLine(year = new Date().getFullYear()): string {
	return `© ${year} ${BRAND.parentCompany}. All rights reserved.`;
}

/** Convenience: brand relationship sentence used in legal pages + footer. */
export const PRODUCT_BY_LINE = `${BRAND.productName} is a product by ${BRAND.parentCompany}.`;
