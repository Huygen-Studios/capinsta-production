export function capinstaBackendUrl({
	backendBaseUrl,
	path,
	search,
}: {
	backendBaseUrl: string;
	path: string[];
	search?: string;
}) {
	const base = backendBaseUrl.replace(/\/+$/, "");
	const pathname = path.map(encodeURIComponent).join("/");
	return `${base}/${pathname}${search ?? ""}`;
}
