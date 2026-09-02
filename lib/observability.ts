/**
 * Server-side error reporting.
 *
 * The rule this codebase has always followed is that secrets, tokens,
 * passwords, request bodies, and Yjs updates never enter logs. That rule was
 * previously enforced by logging *nothing*, which left a production 503 with no
 * trace at all. This module keeps the rule and restores the signal: only an
 * error's class, message, and stack are emitted, and the message is redacted
 * for anything that looks like a credential-bearing URL before it is written.
 *
 * Never pass a request body, a token, a password, or document state here.
 */

const CREDENTIAL_URL = /\b([a-z][a-z0-9+.-]*:\/\/)[^/\s@]*@/gi;
const BEARER = /\b(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi;

/** Strips inline credentials so a driver's own message cannot leak one. */
export function redact(value: string) {
  return value.replace(CREDENTIAL_URL, "$1<redacted>@").replace(BEARER, "$1<redacted>");
}

function describe(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redact(error.message),
      stack: error.stack ? redact(error.stack) : undefined,
    };
  }
  return { name: "NonError", message: redact(String(error)) };
}

/**
 * Records a server-side failure as one structured line.
 *
 * `scope` identifies the operation, never the data: `"rooms.create"`, not the
 * path that was being created.
 */
export function reportError(scope: string, error: unknown) {
  const detail = describe(error);
  console.error(
    JSON.stringify({
      level: "error",
      scope,
      name: detail.name,
      message: detail.message,
      stack: detail.stack,
      at: new Date().toISOString(),
    }),
  );
}

const throttled = new Map<string, number>();

/**
 * Records a failure that can repeat many times per second.
 *
 * A dropped Redis connection retries on a backoff, so an unthrottled handler
 * would fill the log with the same line. One line per scope per interval keeps
 * the outage visible without burying everything else.
 */
export function reportErrorThrottled(scope: string, error: unknown, intervalMs = 30_000) {
  const now = Date.now();
  const last = throttled.get(scope) ?? 0;
  if (now - last < intervalMs) return;
  throttled.set(scope, now);
  reportError(scope, error);
}

/** Records a non-error operational event worth seeing in production logs. */
export function reportEvent(scope: string, detail?: Record<string, string | number | boolean>) {
  console.warn(
    JSON.stringify({ level: "warn", scope, ...detail, at: new Date().toISOString() }),
  );
}
