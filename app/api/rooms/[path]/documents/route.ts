import { NextRequest } from "next/server";
import { authorizeRoomRequest, withSession } from "@/lib/auth/room-access";
import { runInBackground } from "@/lib/background";
import { createUploadToken, isBlobConfigured } from "@/lib/documents/blob";
import { sweepExpiredDocuments } from "@/lib/documents/cleanup";
import {
  MAX_DOCUMENT_BYTES,
  maxDocumentsPerRoom,
  maxRoomDocumentBytes,
} from "@/lib/documents/config";
import {
  documentStorageKey,
  safeContentType,
  safeDisplayName,
} from "@/lib/documents/filenames";
import { authorizationFailure } from "@/lib/documents/responses";
import {
  createPendingDocument,
  deleteDocumentRow,
  getRoomUsage,
  listRoomDocuments,
} from "@/lib/documents/store";
import { noStoreJson, readSmallJson, serviceError } from "@/lib/http";
import { enforceRateLimit, requestSubject } from "@/lib/security/rate-limit";
import { touchRoom } from "@/lib/storage/rooms";
import { createDocumentSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function limits() {
  return {
    maxFileBytes: MAX_DOCUMENT_BYTES,
    maxDocuments: maxDocumentsPerRoom(),
    maxTotalBytes: maxRoomDocumentBytes(),
  };
}

/** Active documents for the room. Expiry is filtered in SQL, never in the browser. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string }> },
) {
  try {
    await enforceRateLimit({
      scope: "documents-list",
      subject: requestSubject(request),
      limit: 60,
      windowSeconds: 60,
    });

    const authorization = await authorizeRoomRequest(
      request,
      (await context.params).path,
    );
    if (authorization.status !== "authorized") {
      return authorizationFailure(authorization);
    }

    if (!isBlobConfigured()) {
      return withSession(
        noStoreJson({ enabled: false, documents: [], limits: limits() }),
        authorization.sessionToken,
      );
    }

    const [documents, usage] = await Promise.all([
      listRoomDocuments(authorization.room.id),
      getRoomUsage(authorization.room.id),
    ]);

    // Room activity is a convenient moment to reclaim expired bytes. The
    // scheduled job stays the durable guarantee; this only narrows the window.
    runInBackground(sweepExpiredDocuments);

    return withSession(
      noStoreJson({
        enabled: true,
        documents,
        usage,
        limits: limits(),
        participantId: authorization.grant.participantId,
      }),
      authorization.sessionToken,
    );
  } catch (error) {
    return serviceError(error);
  }
}

/**
 * Reserves a document and returns a credential for a direct browser upload.
 *
 * The server chooses the object key and mints a token scoped to exactly that
 * key with the 300 MiB ceiling baked in, so the bytes go straight to storage
 * without passing through this function and cannot be redirected or oversized.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string }> },
) {
  try {
    await enforceRateLimit({
      scope: "documents-upload",
      subject: requestSubject(request),
      limit: 30,
      windowSeconds: 60 * 60,
    });

    const authorization = await authorizeRoomRequest(
      request,
      (await context.params).path,
    );
    if (authorization.status !== "authorized") {
      return authorizationFailure(authorization);
    }

    // Input is validated before storage availability, so the 300 MB ceiling is
    // reported as such whether or not a blob store is configured.
    const parsed = createDocumentSchema.safeParse(await readSmallJson(request));
    if (!parsed.success) {
      const tooLarge = parsed.error.issues.some(
        (issue) => issue.path[0] === "size" && issue.code === "too_big",
      );
      if (tooLarge) {
        return noStoreJson(
          { code: "FILE_TOO_LARGE", message: "Files must be 300 MB or smaller." },
          { status: 413 },
        );
      }
      return noStoreJson(
        { code: "INVALID_INPUT", message: "That file could not be accepted." },
        { status: 400 },
      );
    }

    if (!isBlobConfigured()) {
      return noStoreJson(
        { code: "SERVICE_UNAVAILABLE", message: "File sharing is not configured." },
        { status: 503 },
      );
    }

    const usage = await getRoomUsage(authorization.room.id);
    if (usage.documents >= maxDocumentsPerRoom()) {
      return noStoreJson(
        {
          code: "ROOM_DOCUMENT_LIMIT",
          message: `A room holds up to ${maxDocumentsPerRoom()} files at a time. Remove one or wait for a file to expire.`,
        },
        { status: 409 },
      );
    }
    if (usage.bytes + parsed.data.size > maxRoomDocumentBytes()) {
      return noStoreJson(
        {
          code: "ROOM_STORAGE_LIMIT",
          message: "This room has reached its temporary storage limit.",
        },
        { status: 409 },
      );
    }

    const documentId = crypto.randomUUID();
    const filename = safeDisplayName(parsed.data.filename);
    const storageKey = documentStorageKey({
      roomId: authorization.room.id,
      documentId,
      filename,
    });

    const document = await createPendingDocument({
      documentId,
      roomId: authorization.room.id,
      roomPath: authorization.room.path,
      storageKey,
      filename,
      contentType: safeContentType(parsed.data.contentType),
      declaredSize: parsed.data.size,
      uploadedBy: authorization.grant.participantId,
    });
    if (!document) {
      return noStoreJson(
        { code: "SERVICE_UNAVAILABLE", message: "File sharing is unavailable." },
        { status: 503 },
      );
    }

    let upload;
    try {
      upload = await createUploadToken(storageKey);
    } catch (error) {
      // Never leave a reservation behind for a credential that was never issued.
      await deleteDocumentRow(documentId).catch(() => undefined);
      throw error;
    }

    await touchRoom(authorization.room);

    return withSession(
      noStoreJson(
        {
          documentId,
          storageKey,
          uploadToken: upload.token,
          uploadTokenExpiresAt: new Date(upload.validUntil).toISOString(),
          expiresAt: document.expiresAt.toISOString(),
        },
        { status: 201 },
      ),
      authorization.sessionToken,
    );
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      error instanceof TypeError ||
      error instanceof RangeError
    ) {
      return noStoreJson(
        { code: "INVALID_INPUT", message: "That file could not be accepted." },
        { status: 400 },
      );
    }
    return serviceError(error);
  }
}
