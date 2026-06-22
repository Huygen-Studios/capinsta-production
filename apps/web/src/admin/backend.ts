import "server-only";

import { createHmac, randomUUID } from "node:crypto";
import type { AdminPermission } from "./permissions";
import { requireAdminPermission } from "./auth";
import { getAdminRequestMetadata } from "./request";
import { webEnv } from "@/env/web";

function encode(value: object) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export async function adminBackendFetch({
  path,
  permission,
  init,
}: {
  path: string;
  permission: AdminPermission;
  init?: RequestInit;
}) {
  const context = await requireAdminPermission(permission);
  const request = await getAdminRequestMetadata();
  const now = Math.floor(Date.now() / 1000);
  const method = (init?.method ?? "GET").toUpperCase();
  const payload = encode({
    iss: webEnv.ADMIN_ASSERTION_ISSUER,
    aud: "capinsta-fastapi-admin",
    sub: context.userId,
    permission,
    aal: context.aal,
    jti: randomUUID(),
    iat: now,
    nbf: now - 2,
    correlation_id: request.correlationId,
    method,
    path,
    exp: now + 45,
  });
  const signature = createHmac("sha256", webEnv.INTERNAL_ADMIN_API_SECRET)
    .update(payload)
    .digest("base64url");
  const headers = new Headers(init?.headers);
  headers.set("x-capinsta-admin-assertion", `${payload}.${signature}`);
  headers.set("x-correlation-id", request.correlationId);
  return fetch(`${webEnv.BACKEND_INTERNAL_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(10000),
  });
}
