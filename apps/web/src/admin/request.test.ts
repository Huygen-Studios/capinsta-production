import { describe, expect, test } from "bun:test";
import { resolveClientIp } from "./request-ip";

describe("trusted proxy IP handling", () => {
  test("production untrusted mode ignores spoofed forwarding headers", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.9",
      "cf-connecting-ip": "203.0.113.10",
      "x-real-ip": "203.0.113.11",
    });
    expect(
      resolveClientIp({
        requestHeaders: headers,
        mode: "none",
        nodeEnv: "production",
      }),
    ).toBe("unknown");
  });

  test("Coolify mode uses only the first Traefik forwarding hop", () => {
    const headers = new Headers({
      "x-forwarded-for": "2001:db8::1, 10.0.0.4",
    });
    expect(
      resolveClientIp({
        requestHeaders: headers,
        mode: "coolify",
        nodeEnv: "production",
      }),
    ).toBe("2001:db8::1");
  });

  test("Cloudflare mode ignores x-forwarded-for", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.9",
      "cf-connecting-ip": "198.51.100.8",
    });
    expect(
      resolveClientIp({
        requestHeaders: headers,
        mode: "cloudflare",
        nodeEnv: "production",
      }),
    ).toBe("198.51.100.8");
  });
});
