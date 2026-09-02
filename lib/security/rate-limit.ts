import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { getRequiredEnv } from "@/lib/config";
import { getRedis } from "@/lib/redis";
import { keys } from "@/lib/storage/keys";
import { retryAfterLabel } from "@/lib/ui-labels";

export class RateLimitError extends Error {
  retryAfter: number;

  constructor(retryAfter: number) {
    super("Too many requests.");
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }

  /**
   * The wait is already known here, so it is stated rather than left to the
   * caller to guess. "Please wait and try again" gave a user no way to tell a
   * ten-second pause from a ten-minute one.
   */
  get userMessage() {
    return `Too many requests. Try again in ${retryAfterLabel(this.retryAfter)}.`;
  }
}

/**
 * Identifies the caller for rate limiting.
 *
 * On Vercel the edge network overwrites `x-forwarded-for` with the real client
 * address, so the first entry is trustworthy — verified by confirming that a
 * spoofed header does not reset a limit. Behind any proxy that *appends*
 * instead of overwriting, this would need to read from the right-hand side.
 */
export function requestSubject(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const raw = forwarded || request.headers.get("x-real-ip") || "unknown";
  return createHash("sha256")
    .update(raw)
    .update(getRequiredEnv("SESSION_PEPPER"))
    .digest("hex")
    .slice(0, 24);
}

export async function enforceRateLimit(input: {
  scope: string;
  subject: string;
  limit: number;
  windowSeconds: number;
}) {
  const redis = getRedis();
  const key = keys.rateLimit(input.scope, input.subject);
  const result = (await redis.eval(
    "local n=redis.call('incr',KEYS[1]); if n==1 then redis.call('expire',KEYS[1],ARGV[1]); end; return {n,redis.call('ttl',KEYS[1])}",
    1,
    key,
    input.windowSeconds,
  )) as [number, number];

  if (Number(result[0]) > input.limit) {
    throw new RateLimitError(Math.max(1, Number(result[1])));
  }
}

/**
 * Reads a limit without consuming from it.
 *
 * Used where a request must be validated before it is allowed to spend quota,
 * so a rejected request cannot exhaust a budget it never used.
 */
export async function peekRateLimit(input: {
  scope: string;
  subject: string;
  limit: number;
}) {
  const redis = getRedis();
  const key = keys.rateLimit(input.scope, input.subject);
  const [count, ttl] = await Promise.all([redis.get(key), redis.ttl(key)]);
  if (Number(count || 0) >= input.limit) {
    throw new RateLimitError(Math.max(1, Number(ttl) > 0 ? Number(ttl) : 60));
  }
}
