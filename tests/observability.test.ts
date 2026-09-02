import { afterEach, describe, expect, it, vi } from "vitest";
import { redact, reportError, reportErrorThrottled } from "@/lib/observability";

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Logging was previously absent entirely so that secrets could never reach it.
 * Restoring the signal is only acceptable if that guarantee survives, so the
 * redaction is treated as a security control and tested as one.
 */
describe("error reporting redaction", () => {
  it("strips credentials from a connection URL", () => {
    expect(redact("connect rediss://default:sup3rs3cret@host.upstash.io:6379 failed")).toBe(
      "connect rediss://<redacted>@host.upstash.io:6379 failed",
    );
    expect(
      redact("postgresql://user:pa55word@ep-x.neon.tech/db?sslmode=require"),
    ).toBe("postgresql://<redacted>@ep-x.neon.tech/db?sslmode=require");
  });

  it("strips bearer tokens", () => {
    expect(redact("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc-_123")).toBe(
      "Authorization: Bearer <redacted>",
    );
  });

  it("leaves an ordinary message intact", () => {
    expect(redact("connect ECONNREFUSED 127.0.0.1:6379")).toBe(
      "connect ECONNREFUSED 127.0.0.1:6379",
    );
  });

  it("redacts the message and the stack of a reported error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    reportError("test.scope", new Error("failed for rediss://u:p@host:6379"));

    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line.scope).toBe("test.scope");
    expect(line.message).not.toContain("u:p@");
    expect(line.message).toContain("<redacted>");
    expect(line.stack ?? "").not.toContain("u:p@");
  });

  it("collapses a repeating failure to one line per interval", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const scope = `test.throttle.${crypto.randomUUID()}`;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      reportErrorThrottled(scope, new Error("reconnecting"));
    }
    // A retry loop must stay visible without burying everything else.
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
