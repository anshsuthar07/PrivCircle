import { afterEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("anonymous session cookies", () => {
  it("uses a host-only secure cookie in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { attachSessionCookie, getSessionCookieName } = await import(
      "@/lib/auth/session"
    );
    const response = NextResponse.json({ ok: true });

    attachSessionCookie(response, "opaque-session-token");

    expect(getSessionCookieName()).toBe("__Host-pc_session");
    const cookie = response.headers.get("set-cookie") || "";
    expect(cookie).toContain("__Host-pc_session=opaque-session-token");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=strict");
  });
});
