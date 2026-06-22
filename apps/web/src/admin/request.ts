import "server-only";

import { createHash, createHmac, randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { webEnv } from "@/env/web";
import { resolveClientIp } from "./request-ip";

export async function getAdminRequestMetadata() {
  const requestHeaders = await headers();
  const ip = resolveClientIp({
    requestHeaders,
    mode: webEnv.TRUSTED_PROXY_MODE,
    nodeEnv: webEnv.NODE_ENV,
  });
  const userAgent = (requestHeaders.get("user-agent") ?? "unknown").slice(
    0,
    240,
  );
  const requestId = requestHeaders.get("x-request-id") ?? randomUUID();
  const correlationId = requestHeaders.get("x-correlation-id") ?? requestId;
  return {
    ip,
    ipHash: createHmac("sha256", webEnv.ADMIN_SECURITY_PEPPER)
      .update(ip)
      .digest("hex"),
    userAgent,
    userAgentHash: createHash("sha256").update(userAgent).digest("hex"),
    requestId,
    correlationId,
  };
}

export function normalizedEmailHash(email: string) {
  return createHmac("sha256", webEnv.ADMIN_SECURITY_PEPPER)
    .update(email.trim().toLowerCase())
    .digest("hex");
}
