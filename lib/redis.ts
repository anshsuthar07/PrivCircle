import Redis from "ioredis";
import { getRequiredEnv } from "./config";
import { reportErrorThrottled } from "./observability";

declare global {
  var __privCircleRedis: Redis | undefined;
}

export function getRedis() {
  if (!globalThis.__privCircleRedis) {
    globalThis.__privCircleRedis = new Redis(getRequiredEnv("REDIS_URL"), {
      enableReadyCheck: true,
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      retryStrategy(times) {
        return Math.min(times * 100, 2_000);
      },
    });

    globalThis.__privCircleRedis.on("error", (error) => {
      // Throttled and redacted: a reconnect loop must stay visible without
      // filling the log, and a driver message must never carry the URL's
      // credentials. Command payloads are still never logged.
      reportErrorThrottled("redis.connection", error);
    });
  }

  return globalThis.__privCircleRedis;
}
