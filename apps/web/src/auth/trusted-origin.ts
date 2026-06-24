// eslint-disable-next-line opencut/prefer-object-params
export function getTrustedPublicOrigin(
	request: Request,
	siteUrlEnv = process.env.NEXT_PUBLIC_SITE_URL,
): string {
	const isInternalHost = (host: string) => {
		const lower = host.toLowerCase().split(":")[0];
		return (
			lower === "localhost" ||
			lower === "0.0.0.0" ||
			lower === "127.0.0.1"
		);
	};

	const getOriginFromUrl = (urlStr: string | null | undefined): string | null => {
		if (!urlStr) return null;
		try {
			const parsed = new URL(urlStr);
			if (isInternalHost(parsed.hostname)) return null;
			return parsed.origin;
		} catch {
			return null;
		}
	};

	const siteUrlOrigin = getOriginFromUrl(siteUrlEnv);
	if (siteUrlOrigin) {
		return siteUrlOrigin;
	}

	const forwardedHost = request.headers.get("x-forwarded-host");
	const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
	if (forwardedHost) {
		const forwardedUrl = `${forwardedProto}://${forwardedHost}`;
		const forwardedOrigin = getOriginFromUrl(forwardedUrl);
		if (forwardedOrigin) {
			return forwardedOrigin;
		}
	}

	try {
		const requestUrl = new URL(request.url);
		return requestUrl.origin;
	} catch {
		return "http://localhost:3000";
	}
}
