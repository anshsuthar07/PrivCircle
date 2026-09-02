import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema";
import { getRequiredEnv } from "@/lib/config";

/**
 * Hung off `globalThis` for the same reason as the Redis client: a module-local
 * singleton is recreated on every hot reload and on every module re-evaluation
 * in a warm function, which quietly opens a new pool each time against a
 * connection budget that is not generous.
 */
declare global {
  var __privCirclePostgres: Sql | undefined;
  var __privCircleDatabase: PostgresJsDatabase<typeof schema> | undefined;
}

export function getDatabase() {
  if (!globalThis.__privCircleDatabase) {
    globalThis.__privCirclePostgres = postgres(getRequiredEnv("DATABASE_URL"), {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false,
    });
    globalThis.__privCircleDatabase = drizzle(globalThis.__privCirclePostgres, {
      schema,
    });
  }

  return globalThis.__privCircleDatabase;
}
