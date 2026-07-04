import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withBotId } from "botid/next/config";
import { withContentCollections } from "@content-collections/next";
import { withSentryConfig } from "@sentry/nextjs";

const appDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = dirname(dirname(appDir));
const securityHeaders = [
	{
		key: "Content-Security-Policy",
		value: [
			"default-src 'self'",
			"script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com",
			"style-src 'self' 'unsafe-inline'",
			"img-src 'self' blob: data: https:",
			"font-src 'self' data:",
			"media-src 'self' blob: data:",
			"connect-src 'self' https: wss:",
			"frame-ancestors 'none'",
			"object-src 'none'",
			"base-uri 'self'",
			"form-action 'self'",
		].join("; "),
	},
	{ key: "X-Content-Type-Options", value: "nosniff" },
	{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
	{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
	{ key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
	compiler: {
		removeConsole: process.env.NODE_ENV === "production",
	},
	reactStrictMode: true,
	// Production browser source maps materially increase build RAM and disk use.
	// Keep them disabled on the small production VPS; server-side stack traces
	// and local development source maps remain available.
	productionBrowserSourceMaps: false,
	output: "standalone",
	experimental: {
		// Caption generation uploads extracted audio/video through the same-origin
		// Next.js proxy. Next defaults proxy request bodies to 10 MB, which
		// truncated ordinary media uploads before they reached FastAPI.
		// Keep this aligned with the backend MAX_UPLOAD_MB=500 policy.
		proxyClientMaxBodySize: "500mb",
	},
	// Prevent Turbopack from scanning Windows reserved device names
	turbopack: {
		root: workspaceRoot,
		resolveAlias: {},
	},
	async headers() {
		return [
			{
				source: "/:path*",
				headers: securityHeaders,
			},
		];
	},
	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: "plus.unsplash.com",
			},
			{
				protocol: "https",
				hostname: "images.unsplash.com",
			},
			{
				protocol: "https",
				hostname: "images.marblecms.com",
			},
			{
				protocol: "https",
				hostname: "lh3.googleusercontent.com",
			},
			{
				protocol: "https",
				hostname: "avatars.githubusercontent.com",
			},
			{
				protocol: "https",
				hostname: "api.iconify.design",
			},
			{
				protocol: "https",
				hostname: "api.simplesvg.com",
			},
			{
				protocol: "https",
				hostname: "api.unisvg.com",
			},
			{
				protocol: "https",
				hostname: "cdn.brandfetch.io",
			},
		],
	},
};

const composedConfig = withContentCollections(withBotId(nextConfig));

export default withSentryConfig(composedConfig, {
	org: "huygen-studios",
	project: "javascript-nextjs",
	telemetry: false,
	silent: true,
	sourcemaps: {
		disable: process.env.SENTRY_AUTH_TOKEN ? false : true,
	},
	webpack: {
		treeshake: {
			removeDebugLogging: true,
		},
	},
});
