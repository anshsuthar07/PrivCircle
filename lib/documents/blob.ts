import { del, head, issueSignedToken, presignUrl } from "@vercel/blob";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { getRequiredEnv } from "@/lib/config";
import {
  DOWNLOAD_URL_TTL_SECONDS,
  MAX_DOCUMENT_BYTES,
  UPLOAD_TOKEN_TTL_SECONDS,
} from "./config";

/**
 * Vercel Blob adapter.
 *
 * Objects are uploaded with `access: "private"`, so they are not served
 * without a signed URL that this server mints after room authorization.
 * The 300 MiB ceiling is carried by the upload token itself, which means the
 * storage service rejects an oversized body even if the browser is patched.
 *
 * One honest limitation: the upload token binds the object key and the size
 * ceiling, but `access` is supplied by the browser on `put`. A participant
 * could therefore mark their own upload public. That exposes only a file they
 * already hold, at a key containing a server-generated UUID, and the object is
 * deleted at expiry regardless. Listing and download stay server-authorized
 * either way, so no other room or participant is affected.
 */

function readWriteToken() {
  return getRequiredEnv("BLOB_READ_WRITE_TOKEN");
}

/** Lets routes answer with a clean 503 instead of throwing when storage is unconfigured. */
export function isBlobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * Mints a single-use upload credential bound to one exact object key.
 *
 * The token encodes the pathname, so a client cannot redirect the upload to
 * another key, and `maximumSizeInBytes`, so it cannot exceed the per-file limit.
 */
export async function createUploadToken(storageKey: string) {
  const validUntil = Date.now() + UPLOAD_TOKEN_TTL_SECONDS * 1000;
  const token = await generateClientTokenFromReadWriteToken({
    token: readWriteToken(),
    pathname: storageKey,
    maximumSizeInBytes: MAX_DOCUMENT_BYTES,
    validUntil,
    addRandomSuffix: false,
    allowOverwrite: false,
  });
  return { token, validUntil };
}

export interface StoredObject {
  size: number;
  contentType: string;
}

/**
 * Reads authoritative object metadata from the store.
 *
 * This is what makes the size limit real: the recorded size comes from the
 * storage provider, never from a number the browser reported.
 */
export async function readStoredObject(storageKey: string): Promise<StoredObject | null> {
  try {
    const result = await head(storageKey, { token: readWriteToken() });
    return { size: result.size, contentType: result.contentType };
  } catch {
    return null;
  }
}

/**
 * Deletes one object. Resolves `true` when the object is gone, including when
 * it was already missing, so cleanup can safely run twice.
 */
export async function deleteStoredObject(storageKey: string): Promise<boolean> {
  try {
    await del(storageKey, { token: readWriteToken() });
    return true;
  } catch {
    // A missing object is not an error for cleanup; a transient failure is
    // retried on the next pass because the row is only removed on success.
    return (await readStoredObject(storageKey)) === null;
  }
}

/**
 * Builds a short-lived presigned GET URL.
 *
 * `documentExpiresAt` caps the signature, so a URL handed out shortly before a
 * document expires cannot outlive the document's own 24-hour lifetime.
 */
export async function createDownloadUrl(input: {
  storageKey: string;
  documentExpiresAt: Date;
  filename: string;
}) {
  const ceiling = input.documentExpiresAt.getTime();
  const validUntil = Math.min(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000, ceiling);
  if (validUntil <= Date.now()) return null;

  const signedToken = await issueSignedToken({
    token: readWriteToken(),
    pathname: input.storageKey,
    operations: ["get"],
    validUntil,
  });

  const { presignedUrl } = await presignUrl(signedToken, {
    operation: "get",
    access: "private",
    pathname: input.storageKey,
    validUntil,
  });

  // `download=1` asks the CDN for an attachment disposition. It is not part of
  // the signed payload, so appending it cannot invalidate the signature.
  const url = new URL(presignedUrl);
  url.searchParams.set("download", "1");
  return { url: url.toString(), validUntil };
}
