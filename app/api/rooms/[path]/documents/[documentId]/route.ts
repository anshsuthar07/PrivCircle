import { NextRequest } from "next/server";
import { authorizeRoomRequest, withSession } from "@/lib/auth/room-access";
import { deleteStoredObject, isBlobConfigured } from "@/lib/documents/blob";
import { isDocumentId, isKeyInRoom } from "@/lib/documents/filenames";
import { authorizationFailure, documentUnavailable } from "@/lib/documents/responses";
import {
  deleteDocumentRow,
  expireDocumentNow,
  findRoomDocument,
} from "@/lib/documents/store";
import { noStoreJson, serviceError } from "@/lib/http";
import { enforceRateLimit, requestSubject } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Removes a document before it expires.
 *
 * Only the participant who uploaded it may do this. Everyone in the room can
 * read every file, but one participant cannot destroy another's — the larger
 * the group, the more that matters, since nothing else in a room is
 * destructive and there is no way to undo a removal.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ path: string; documentId: string }> },
) {
  try {
    const { path, documentId } = await context.params;
    await enforceRateLimit({
      scope: "documents-delete",
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
      !isKeyInRoom(document.storageKey, authorization.room.id)
    ) {
      return documentUnavailable();
    }

    if (document.uploadedBy !== authorization.grant.participantId) {
      return noStoreJson(
        {
          code: "NOT_DOCUMENT_OWNER",
          message: "Only the person who shared this file can remove it.",
        },
        { status: 403 },
      );
    }

    if (await deleteStoredObject(document.storageKey)) {
      await deleteDocumentRow(documentId);
    } else {
      // Storage is unreachable. Retire the document now so it leaves the room
      // immediately, and let cleanup reclaim the object on a later pass.
      await expireDocumentNow(documentId);
    }

    return withSession(noStoreJson({ removed: true }), authorization.sessionToken);
  } catch (error) {
    return serviceError(error, "documents.delete");
  }
}
