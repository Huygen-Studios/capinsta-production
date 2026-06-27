const API_SEGMENT = "api";

function trimSlashes(value: string): string {
	return value.replace(/^\/+|\/+$/g, "");
}

function normalizeApiPath(path: string): string {
	const segments = trimSlashes(path).split("/").filter(Boolean);
	while (segments[0] === API_SEGMENT && segments[1] === API_SEGMENT) {
		segments.shift();
	}
	if (segments[0] !== API_SEGMENT) segments.unshift(API_SEGMENT);
	return `/${segments.join("/")}`;
}

function joinUrl({ baseUrl, path }: { baseUrl: string; path: string }): string {
	const base = baseUrl.replace(/\/+$/, "");
	let normalizedPath = path.startsWith("/") ? path : `/${path}`;
	if (base.endsWith("/api") && normalizedPath.startsWith("/api/")) {
		normalizedPath = normalizedPath.slice(API_SEGMENT.length + 1);
	}
	return `${base}${normalizedPath}`;
}

export function buildCapinstaApiUrl({
	baseUrl,
	path,
}: {
	baseUrl: string;
	path: string;
}): string {
	return joinUrl({ baseUrl, path: normalizeApiPath(path) });
}

export function buildCapinstaHealthUrl({
	baseUrl,
	path = "/health/ready",
}: {
	baseUrl: string;
	path?: string;
}): string {
	return joinUrl({ baseUrl, path });
}
