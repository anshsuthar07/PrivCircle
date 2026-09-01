import { waitUntil } from "@vercel/functions";

/**
 * Runs follow-up work without holding up the response.
 *
 * On Vercel `waitUntil` keeps the function alive until the promise settles;
 * elsewhere it is a no-op and the promise simply runs on its own. Failures are
 * always swallowed, because background work must never affect the response the
 * caller already received.
 */
export function runInBackground(work: () => Promise<unknown>) {
  let promise: Promise<unknown>;
  try {
    promise = work();
  } catch {
    return;
  }

  const guarded = promise.catch(() => undefined);
  try {
    waitUntil(guarded);
  } catch {
    // No request context outside Vercel; the promise still runs.
  }
}
