/**
 * Applies migrations to the local Docker database.
 *
 * drizzle-kit loads `.env` on its own, and `drizzle.config.ts` prefers
 * `DIRECT_DATABASE_URL` — which points at the production database. Running
 * drizzle-kit directly with only `--env-file .env.local` therefore migrates
 * production instead of localhost. This clears that override, then refuses to
 * run against anything that is not a local host.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

if (existsSync(".env.local")) {
  loadEnvFile(".env.local");
}

process.env.DIRECT_DATABASE_URL = "";

const target = process.env.DATABASE_URL;
if (!target) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local first.");
  process.exit(1);
}

const localHostnames = new Set(["localhost", "127.0.0.1", "::1"]);
let hostname;
try {
  hostname = new URL(target).hostname;
} catch {
  console.error("DATABASE_URL is not a valid URL.");
  process.exit(1);
}

if (!localHostnames.has(hostname)) {
  console.error(
    `Refusing to run: db:migrate:local resolved to a non-local host (${hostname}).`,
  );
  console.error("Use `npm run db:migrate` to migrate a remote database.");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["./node_modules/drizzle-kit/bin.cjs", "migrate"],
  { stdio: "inherit", env: process.env },
);

process.exit(result.status ?? 1);
