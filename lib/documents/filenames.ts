/**
 * Filename and storage-key safety.
 *
 * The original filename is never used as a storage key on its own. A key is
 * always `rooms/<roomId>/<documentId>/<sanitized>`, so the unguessable part is
 * server-generated and the user-supplied part is reduced to a single, inert
 * path segment before it is appended.
 */

const MAX_FILENAME_LENGTH = 255;
const MAX_SEGMENT_LENGTH = 120;

/**
 * Reduces arbitrary user input to one safe path segment.
 *
 * Strips directory components (including Windows separators and `..`), control
 * characters, and anything that could be read as a path or query boundary.
 */
export function sanitizeFilename(value: string): string {
  const withoutDirectories = value.split(/[/\\]/).pop() ?? "";
  const cleaned = withoutDirectories
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "")
    .replace(/-{2,}/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/[.-]+$/, "")
    .slice(0, MAX_SEGMENT_LENGTH);

  return cleaned || "file";
}

/** Keeps the display name readable but bounded, without allowing path syntax. */
export function safeDisplayName(value: string): string {
  const withoutDirectories = (value.split(/[/\\]/).pop() ?? "").trim();
  const cleaned = withoutDirectories
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, MAX_FILENAME_LENGTH);
  return cleaned || "file";
}

/**
 * Builds the object key for a document.
 *
 * The `documentId` directory is what makes the key unguessable; the trailing
 * segment only exists so the storage provider serves a sensible filename.
 */
export function documentStorageKey(input: {
  roomId: string;
  documentId: string;
  filename: string;
}) {
  return `rooms/${input.roomId}/${input.documentId}/${sanitizeFilename(input.filename)}`;
}

/** True when `key` is a well-formed key for this room, used as a defensive check. */
export function isKeyInRoom(key: string, roomId: string) {
  return key.startsWith(`rooms/${roomId}/`) && !key.includes("..");
}

const GENERIC_CONTENT_TYPE = "application/octet-stream";

/**
 * Normalizes a client-declared content type. Unrecognized or malformed values
 * fall back to a generic type; uploads are never parsed or rendered, so the
 * value only affects the download response.
 */
export function safeContentType(value: unknown): string {
  if (typeof value !== "string") return GENERIC_CONTENT_TYPE;
  const candidate = value.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]{0,60}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,60}$/.test(candidate)) {
    return GENERIC_CONTENT_TYPE;
  }
  // Never let an upload be served as an active document type.
  if (candidate === "text/html" || candidate === "application/xhtml+xml" || candidate === "image/svg+xml") {
    return GENERIC_CONTENT_TYPE;
  }
  return candidate;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Guards route parameters before they reach a `uuid` column, so a malformed id
 * is a clean 404 rather than a database error.
 */
export function isDocumentId(value: string) {
  return UUID_PATTERN.test(value);
}
