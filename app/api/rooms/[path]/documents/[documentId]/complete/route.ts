import { NextRequest } from "next/server";
import { authorizeRoomRequest, withSession } from "@/lib/auth/room-access";
import {
  deleteStoredObject,
  isBlobConfigured,
  readStoredObject,
} from "@/lib/documents/blob";
import { MAX_DOCUMENT_BYTES } from "@/lib/documents/config";
import {
  isDocumentId,
  isKeyInRoom,
  safeContentType,
} from "@/lib/documents/filenames";
import { authorizationFailure, documentUnavailable } from "@/lib/documents/responses";
import {
  deleteDocumentRow,
  findRoomDocument,
  markDocumentReady,
} from "@/lib/documents/store";
import { noStoreJson, serviceError } from "@/lib/http";
import { enforceRateLimit, requestSubject } from "@/lib/security/rate-limit";
import { touchRoom } from "@/lib/storage/rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Finalizes an upload.
 *
 * The recorded size comes from `head()` against the storage provider, not from
 * anything the browser reported, so a client that skips or fakes its own size
 * check still cannot register a file above the limit. An object that somehow
 * exceeded the ceiling is deleted here rather than left orphaned.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string; documentId: string }> },
) {
  try {
    const { path, documentId } = await context.params;
    await enforceRateLimit({
      scope: "documents-complete",
      subject: requestSubject(request),
      limit: 60,
      windowSeconds: 60 * 60,
    });

    const authorization = await authorizeRoomRequest(request, path);
    if (authorization.status !== "authorized") {
      return authorizationFailure(authorization);
    }

    if (!isBlobConfigured()) {
      return noStoreJson(
        { code: "SERVICE_UNAVAILABLE", message: "File sharing is not configured." },
        { status: 503 },
      );
    }
    if (!isDocumentId(documentId)) return documentUnavailable();

    const document = await findRoomDocument({
      documentId,
      roomId: authorization.room.id,
    });
    if (
      !document ||
      document.roomPath !== authorization.room.path ||
      !isKeyInRoom(document.storageKey, authorization.room.id) ||
      document.expiresAt.getTime() <= Date.now()
    ) {
      return documentUnavailable();
    }

    const stored = await readStoredObject(document.storageKey);
    if (!stored) {
      return noStoreJson(
        {
          code: "UPLOAD_INCOMPLETE",
          message: "The upload did not finish. Please try again.",
        },
        { status: 409 },
      );
    }

    if (stored.size > MAX_DOCUMENT_BYTES) {
      await deleteStoredObject(document.storageKey).catch(() => undefined);
      await deleteDocumentRow(documentId).catch(() => undefined);
      return noStoreJson(
        { code: "FILE_TOO_LARGE", message: "Files must be 300 MB or smaller." },
        { status: 413 },
      );
    }

    const ready = await markDocumentReady({
      documentId,
      roomId: authorization.room.id,
      sizeBytes: stored.size,
      contentType: safeContentType(stored.contentType || document.contentType),
    });
    if (!ready) return documentUnavailable();

    await touchRoom(authorization.room);

    return withSession(
      noStoreJson({
        id: ready.id,
        filename: ready.originalFilename,
        contentType: ready.contentType,
        sizeBytes: ready.sizeBytes,
        uploadedBy: ready.uploadedBy,
        createdAt: ready.createdAt.toISOString(),
        expiresAt: ready.expiresAt.toISOString(),
      }),
      authorization.sessionToken,
    );
  } catch (error) {
    return serviceError(error, "documents.complete");
  }
}
