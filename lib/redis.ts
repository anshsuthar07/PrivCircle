import Redis from "ioredis";
import { getRequiredEnv } from "./config";

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

    globalThis.__privCircleRedis.on("error", () => {
      // Deliberately silent: credentials and command payloads never enter logs.
    });
  }

  return globalThis.__privCircleRedis;
}
