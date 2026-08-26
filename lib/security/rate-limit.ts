import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { getRequiredEnv } from "@/lib/config";
import { getRedis } from "@/lib/redis";
import { keys } from "@/lib/storage/keys";

export class RateLimitError extends Error {
  retryAfter: number;

  constructor(retryAfter: number) {
    super("Too many requests.");
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

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
