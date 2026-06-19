import { ADS_TXT_CONTENT, ADSENSE_ENABLED } from "@/site/ads";

/**
 * /ads.txt route.
 *
 * Serves the AdSense ads.txt file ONLY when a valid publisher ID is configured
 * via NEXT_PUBLIC_ADSENSE_PUBLISHER_ID. When no real ID is set, this route
 * returns 404 so we never publish a fake placeholder ID like
 * pub-0000000000000000.
 *
 * See src/site/ads.ts for configuration details.
 */
export function GET() {
	if (!ADSENSE_ENABLED || !ADS_TXT_CONTENT) {
		return new Response("Not Found", { status: 404 });
	}

	return new Response(ADS_TXT_CONTENT, {
		status: 200,
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"Cache-Control": "public, max-age=86400",
		},
	});
}
