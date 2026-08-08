import { BRAND } from "./brand";

/**
 * Public social/external profile links.
 *
 * Only platforms that actually have a real Capinsta / Huygen Studios profile
 * are listed. We deliberately omit X/Twitter and Discord because Capinsta does
 * not maintain real profiles there — never substitute fake placeholders.
 */
export const SOCIAL_LINKS = {
	/** Parent-company marketing site. */
	company: BRAND.companyWebsite,
} as const;
