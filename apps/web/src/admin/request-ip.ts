export function normalizeIp(value: string) {
  const candidate = value.trim().replace(/^\[|\]$/g, "");
  if (!candidate || candidate.length > 64 || /[^0-9a-fA-F:.]/.test(candidate)) {
    return "unknown";
  }
  return candidate.toLowerCase();
}

export function resolveClientIp({
  requestHeaders,
  mode,
  nodeEnv,
}: {
  requestHeaders: Pick<Headers, "get">;
  mode: "none" | "cloudflare" | "coolify";
  nodeEnv: "development" | "production" | "test";
}) {
  if (mode === "cloudflare") {
    return normalizeIp(requestHeaders.get("cf-connecting-ip") ?? "");
  }
  if (mode === "coolify") {
    return normalizeIp(
      (requestHeaders.get("x-forwarded-for") ?? "").split(",")[0] ?? "",
    );
  }
  if (nodeEnv !== "production") {
    return normalizeIp(requestHeaders.get("x-real-ip") ?? "127.0.0.1");
  }
  return "unknown";
}
