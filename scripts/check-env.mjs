import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const fileEnvironment = {};
const fileFlag = process.argv.indexOf("--file");
const requestedFile = fileFlag >= 0 ? process.argv[fileFlag + 1] : null;
if (fileFlag >= 0 && (!requestedFile || !existsSync(requestedFile))) {
  console.error("Environment configuration is invalid:");
  console.error("- The requested environment file does not exist.");
  process.exit(1);
}

const files = requestedFile ? [requestedFile] : [".env", ".env.local"];
for (const file of files) {
  if (existsSync(file)) {
    Object.assign(fileEnvironment, parseEnv(readFileSync(file, "utf8")));
  }
}

const environment = { ...fileEnvironment, ...process.env };
const errors = [];
const required = [
  "REDIS_URL",
  "DATABASE_URL",
  "ROOM_TOKEN_SECRET",
  "SESSION_PEPPER",
  "APP_ORIGIN",
];

for (const name of required) {
  if (!environment[name]) errors.push(`${name} is required.`);
}

if ((environment.ROOM_TOKEN_SECRET || "").length < 32) {
  errors.push("ROOM_TOKEN_SECRET must contain at least 32 characters.");
}
if ((environment.SESSION_PEPPER || "").length < 32) {
  errors.push("SESSION_PEPPER must contain at least 32 characters.");
}
if (
  environment.ROOM_TOKEN_SECRET &&
  environment.ROOM_TOKEN_SECRET === environment.SESSION_PEPPER
) {
  errors.push("ROOM_TOKEN_SECRET and SESSION_PEPPER must be different.");
}

function parseUrl(name) {
  const value = environment[name];
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    errors.push(`${name} must be a valid URL.`);
    return null;
  }
}

const appOrigin = parseUrl("APP_ORIGIN");
const redisUrl = parseUrl("REDIS_URL");
const databaseUrl = parseUrl("DATABASE_URL");
const directDatabaseUrl = environment.DIRECT_DATABASE_URL
  ? parseUrl("DIRECT_DATABASE_URL")
  : null;
const websocketUrl = environment.NEXT_PUBLIC_WS_URL
  ? parseUrl("NEXT_PUBLIC_WS_URL")
  : null;

const localHostnames = new Set(["localhost", "127.0.0.1", "::1"]);
const isLocal = appOrigin ? localHostnames.has(appOrigin.hostname) : false;

if (appOrigin) {
  if (!isLocal && appOrigin.protocol !== "https:") {
    errors.push("APP_ORIGIN must use HTTPS outside local development.");
  }
  if (
    appOrigin.pathname !== "/" ||
    appOrigin.search ||
    appOrigin.hash ||
    appOrigin.username ||
    appOrigin.password
  ) {
    errors.push("APP_ORIGIN must contain only the canonical origin.");
  }
}

if (redisUrl) {
  const accepted = isLocal ? ["redis:", "rediss:"] : ["rediss:"];
  if (!accepted.includes(redisUrl.protocol)) {
    errors.push(
      isLocal
        ? "REDIS_URL must use redis:// or rediss://."
        : "Production REDIS_URL must use encrypted rediss://.",
    );
  }
}

function validateDatabaseUrl(name, value, requirePooler) {
  if (!value) return;
  if (!["postgres:", "postgresql:"].includes(value.protocol)) {
    errors.push(`${name} must use the PostgreSQL protocol.`);
  }
  if (!isLocal && value.searchParams.get("sslmode") !== "require") {
    errors.push(`${name} must include sslmode=require in production.`);
  }
  if (requirePooler && !isLocal && !value.hostname.includes("-pooler.")) {
    errors.push("DATABASE_URL must use Neon's pooled hostname in production.");
  }
}

validateDatabaseUrl("DATABASE_URL", databaseUrl, true);
validateDatabaseUrl("DIRECT_DATABASE_URL", directDatabaseUrl, false);

// Temporary room documents are optional: without a blob token the feature
// reports itself as unavailable instead of breaking the room, so these values
// are validated only when they are present.
if (environment.BLOB_READ_WRITE_TOKEN) {
  if (!environment.BLOB_READ_WRITE_TOKEN.startsWith("vercel_blob_rw_")) {
    errors.push("BLOB_READ_WRITE_TOKEN does not look like a Vercel Blob read-write token.");
  }
  if (!isLocal && !environment.CRON_SECRET) {
    errors.push(
      "CRON_SECRET is required in production when BLOB_READ_WRITE_TOKEN is set, so expired documents can be reclaimed.",
    );
  }
}

if (environment.CRON_SECRET && environment.CRON_SECRET.length < 32) {
  errors.push("CRON_SECRET must contain at least 32 characters.");
}

// Inlined into the client bundle at build time, so a bad value ships to the
// browser as well as the server. At least two people, or a room is not shared.
if (environment.NEXT_PUBLIC_ROOM_CAPACITY) {
  const capacity = Number(environment.NEXT_PUBLIC_ROOM_CAPACITY);
  if (!(Number.isSafeInteger(capacity) && capacity >= 2)) {
    errors.push("NEXT_PUBLIC_ROOM_CAPACITY must be a whole number of 2 or more.");
  }
}

for (const name of ["ROOM_DOCUMENT_LIMIT", "ROOM_DOCUMENT_TOTAL_BYTES", "DOCUMENT_CLEANUP_BATCH"]) {
  const value = environment[name];
  if (value && !(Number.isSafeInteger(Number(value)) && Number(value) > 0)) {
    errors.push(`${name} must be a positive integer.`);
  }
}

if (websocketUrl) {
  const accepted = isLocal ? ["ws:", "wss:"] : ["wss:"];
  if (!accepted.includes(websocketUrl.protocol)) {
    errors.push(
      isLocal
        ? "NEXT_PUBLIC_WS_URL must use ws:// or wss://."
        : "Production NEXT_PUBLIC_WS_URL must use wss://.",
    );
  }
}

if (errors.length > 0) {
  console.error("Environment configuration is invalid:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Environment configuration is valid.");
