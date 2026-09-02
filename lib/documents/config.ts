/**
 * Temporary room document limits.
 *
 * `MAX_DOCUMENT_BYTES` is the one hard product requirement and is not
 * configurable. The aggregate protections below are configurable so an operator
 * can tune storage spend without a code change.
 */

function positiveInteger(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Hard per-file ceiling: 300 MiB. Enforced by the client, the upload token, and `head()`. */
export const MAX_DOCUMENT_BYTES = 300 * 1024 * 1024;

/** Documents live exactly 24 hours from creation. */
export const DOCUMENT_TTL_SECONDS = 24 * 60 * 60;

/**
 * A `pending` row is a reserved storage key with no confirmed object yet.
 * Anything still pending after this window is treated as an abandoned upload
 * and reclaimed by cleanup.
 */
export const UPLOAD_WINDOW_SECONDS = 60 * 60;

/** Upload tokens are scoped to a single key and expire with the upload window. */
export const UPLOAD_TOKEN_TTL_SECONDS = UPLOAD_WINDOW_SECONDS;

/** Presigned download URLs are deliberately short lived and never outlive the document. */
export const DOWNLOAD_URL_TTL_SECONDS = 60;

/** Maximum active (ready or pending) documents in one room. */
export function maxDocumentsPerRoom() {
  return positiveInteger("ROOM_DOCUMENT_LIMIT", 20);
}

/**
 * Maximum aggregate bytes reserved by one room's active documents.
 *
 * Held at the same 300 MiB as the per-file ceiling, so a room's whole file
 * allowance is one maximum-size upload. A larger budget per room made it
 * possible for a couple of rooms to consume the entire hosting quota between
 * them, which takes file sharing down for everybody else.
 */
export function maxRoomDocumentBytes() {
  return positiveInteger("ROOM_DOCUMENT_TOTAL_BYTES", MAX_DOCUMENT_BYTES);
}

/** Rows processed per cleanup pass, so a single run stays inside a function budget. */
export function cleanupBatchSize() {
  return positiveInteger("DOCUMENT_CLEANUP_BATCH", 100);
}
