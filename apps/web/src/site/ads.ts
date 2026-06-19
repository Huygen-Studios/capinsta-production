/**
 * AdSense / ads.txt configuration.
 *
 * The publisher ID is intentionally sourced from an environment variable so the
 * site is "AdSense-ready" without ever publishing a fake placeholder ID. Until a
 * real publisher ID is provided, /ads.txt is NOT served (the route returns 404),
 * and no AdSense scripts are loaded.
 *
 * To activate:
 *   1. Set ADSENSE_PUBLISHER_ID in your production environment, e.g.
 *      ADSENSE_PUBLISHER_ID=pub-1234567890123456
 *   2. Redeploy. /ads.txt will be served automatically.
 *
 * Never commit a real publisher ID to the repository.
 */

const rawId = process.env.NEXT_PUBLIC_ADSENSE_PUBLISHER_ID?.trim() ?? "";

/** Validate that the ID matches Google's pub-XXXXXXXXXXXXXXXX format. */
const PATTERN = /^pub-\d{16}$/;

export const ADSENSE_PUBLISHER_ID: string = PATTERN.test(rawId) ? rawId : "";

/** True only when a valid, real publisher ID is configured. */
export const ADSENSE_ENABLED: boolean = ADSENSE_PUBLISHER_ID.length > 0;

/** The single ads.txt line required by AdSense, or empty when disabled. */
export const ADS_TXT_CONTENT: string = ADSENSE_ENABLED
	? `google.com, ${ADSENSE_PUBLISHER_ID}, DIRECT, f08c47fec0942fa0\n`
	: "";
