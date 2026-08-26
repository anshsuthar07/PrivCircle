import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema";
import { getRequiredEnv } from "@/lib/config";

let client: Sql | undefined;
let database: PostgresJsDatabase<typeof schema> | undefined;

export function getDatabase() {
  if (!database) {
    client = postgres(getRequiredEnv("DATABASE_URL"), {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false,
    });
    database = drizzle(client, { schema });
  }

  return database;
}
