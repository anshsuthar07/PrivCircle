import { NextRequest, NextResponse } from "next/server";
import { authorizeRoomRequest, withSession } from "@/lib/auth/room-access";
import { createDownloadUrl, isBlobConfigured } from "@/lib/documents/blob";
import { isDocumentId, isKeyInRoom } from "@/lib/documents/filenames";
import { authorizationFailure, documentUnavailable } from "@/lib/documents/responses";
import { findDownloadableDocument } from "@/lib/documents/store";
import { noStoreJson, serviceError } from "@/lib/http";
import { enforceRateLimit, requestSubject } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Authorizes a download and redirects to a short-lived presigned URL.
 *
 * This is a browser navigation, so no `Origin` header is required; the request
 * is authenticated by the `SameSite=Strict` session cookie, which a cross-site
 * navigation never carries, plus the same room grant every other endpoint uses.
 *
 * Expiry is re-checked here in SQL rather than trusted from the listing the
 * browser rendered, so a click that lands exactly as a document expires is
 * refused. The signature is capped to the document's own expiry, so a URL
 * captured from the redirect cannot outlive the file it points at.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string; documentId: string }> },
) {
  try {
    const { path, documentId } = await context.params;
    await enforceRateLimit({
      scope: "documents-download",
      subject: requestSubject(request),
      limit: 60,
      windowSeconds: 60,
    });

    const authorization = await authorizeRoomRequest(request, path, {
      requireTrustedOrigin: false,
    });
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

    const document = await findDownloadableDocument({
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

    const download = await createDownloadUrl({
      storageKey: document.storageKey,
      documentExpiresAt: document.expiresAt,
      filename: document.originalFilename,
    });
    if (!download) return documentUnavailable();

    const response = NextResponse.redirect(download.url, 302);
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return withSession(response, authorization.sessionToken);
  } catch (error) {
    return serviceError(error);
  }
}
