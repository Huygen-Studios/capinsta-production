import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { adminSecurityEvents } from "@/db/schema";
import { db } from "@/db";
import { webEnv } from "@/env/web";
import { getAdminRequestMetadata, normalizedEmailHash } from "./request";

const redis = new Redis({
  url: webEnv.UPSTASH_REDIS_REST_URL,
  token: webEnv.UPSTASH_REDIS_REST_TOKEN,
});

const pairLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "15 m"),
  prefix: "admin-login-pair",
});
const ipLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "15 m"),
  prefix: "admin-login-ip",
});
const abuseLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "24 h"),
  prefix: "admin-login-abuse",
});

export async function checkAdminLoginLimit(email: string) {
  const request = await getAdminRequestMetadata();
  const emailHash = normalizedEmailHash(email);
  const pairKey = `${request.ipHash}:${emailHash}`;
  const [pair, ip, abuse, pairBlock, ipBlock, abuseBlock] = await Promise.all([
    pairLimit.getRemaining(pairKey),
    ipLimit.getRemaining(request.ipHash),
    abuseLimit.getRemaining(request.ipHash),
    redis.get<number>(`admin-block:pair:${pairKey}`),
    redis.get<number>(`admin-block:ip:${request.ipHash}`),
    redis.get<number>(`admin-block:abuse:${request.ipHash}`),
  ]);
  const blocked =
    Boolean(pairBlock) ||
    Boolean(ipBlock) ||
    Boolean(abuseBlock) ||
    pair.remaining <= 0 ||
    ip.remaining <= 0 ||
    abuse.remaining <= 0;
  const blockTtls = await Promise.all(
    [
      `admin-block:pair:${pairKey}`,
      `admin-block:ip:${request.ipHash}`,
      `admin-block:abuse:${request.ipHash}`,
    ].map((key) => redis.ttl(key)),
  );
  const reset = Math.max(
    pair.reset,
    ip.reset,
    abuse.reset,
    Date.now() + Math.max(0, ...blockTtls) * 1000,
  );
  return {
    blocked,
    retryAfter: Math.max(1, Math.ceil((reset - Date.now()) / 1000)),
    request,
    emailHash,
  };
}

export async function recordAdminLoginFailure({
  email,
  failureType,
}: {
  email: string;
  failureType: string;
}) {
  const request = await getAdminRequestMetadata();
  const emailHash = normalizedEmailHash(email);
  const pairKey = `${request.ipHash}:${emailHash}`;
  const [pair, ip, abuse] = await Promise.all([
    pairLimit.limit(pairKey),
    ipLimit.limit(request.ipHash),
    abuseLimit.limit(request.ipHash),
  ]);
  const blockedUntil = !abuse.success
    ? new Date(Date.now() + 24 * 60 * 60 * 1000)
    : !ip.success
      ? new Date(Date.now() + 60 * 60 * 1000)
      : !pair.success
        ? new Date(Date.now() + 30 * 60 * 1000)
        : null;
  if (blockedUntil) {
    const block = !abuse.success
      ? { key: `admin-block:abuse:${request.ipHash}`, seconds: 86400 }
      : !ip.success
        ? { key: `admin-block:ip:${request.ipHash}`, seconds: 3600 }
        : { key: `admin-block:pair:${pairKey}`, seconds: 1800 };
    await redis.set(block.key, 1, { ex: block.seconds });
    await db.insert(adminSecurityEvents).values({
      eventType: "admin_login_block",
      ipHash: request.ipHash,
      emailHash,
      attemptCount: Math.max(
        5 - pair.remaining,
        10 - ip.remaining,
        20 - abuse.remaining,
      ),
      severity: !abuse.success ? "high" : "medium",
      blockedUntil,
      metadata: { failureType, userAgentHash: request.userAgentHash },
    });
  }
  const failures = Math.max(5 - pair.remaining, 10 - ip.remaining);
  if (failures >= 3)
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(1500, failures * 180)),
    );
  return { blocked: Boolean(blockedUntil), blockedUntil };
}

export async function clearAdminLoginPair(email: string) {
  const request = await getAdminRequestMetadata();
  const pairKey = `${request.ipHash}:${normalizedEmailHash(email)}`;
  await Promise.all([
    pairLimit.resetUsedTokens(pairKey),
    redis.del(`admin-block:pair:${pairKey}`),
  ]);
}

export async function checkAdminApiRateLimit({
  key,
  kind,
}: {
  key: string;
  kind: "read" | "search" | "mutation" | "critical";
}) {
  const limits = {
    read: [120, "1 m"],
    search: [30, "1 m"],
    mutation: [20, "1 m"],
    critical: [5, "10 m"],
  } as const;
  const [tokens, window] = limits[kind];
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(tokens, window),
    prefix: `admin-api-${kind}`,
  });
  return limiter.limit(key);
}

export async function clearAdminSecurityBlock({
  ipHash,
  emailHash,
}: {
  ipHash: string | null;
  emailHash: string | null;
}) {
  if (!ipHash) return;
  const keys = [`admin-block:ip:${ipHash}`, `admin-block:abuse:${ipHash}`];
  if (emailHash) keys.push(`admin-block:pair:${ipHash}:${emailHash}`);
  await redis.del(...keys);
}
