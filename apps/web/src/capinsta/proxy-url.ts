export function capinstaBackendUrl({
	backendBaseUrl,
	path,
	search,
}: {
	backendBaseUrl: string;
	path: string[];
	search?: string;
}) {
	const url = new URL(backendBaseUrl);
	const basePath = url.pathname.split("/").filter(Boolean);
	let requestPath = path.filter(Boolean);
	while (requestPath[0] === "api" && requestPath[1] === "api")
		requestPath = requestPath.slice(1);
	if (requestPath[0] !== "api") requestPath = ["api", ...requestPath];
	if (basePath.at(-1) === "api" && requestPath[0] === "api")
		requestPath = requestPath.slice(1);
	url.pathname = `/${[...basePath, ...requestPath].map(encodeURIComponent).join("/")}`;
	url.search = search ?? "";
	return url.toString();
}
