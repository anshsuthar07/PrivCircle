import { noStoreJson } from "@/lib/http";
import type { RoomAuthorization } from "@/lib/auth/room-access";

/**
 * Maps a failed room authorization onto the response codes the room UI already
 * understands, so document endpoints never invent their own vocabulary.
 */
export function authorizationFailure(
  authorization: Exclude<RoomAuthorization, { status: "authorized" }>,
) {
  if (authorization.status === "invalid-origin") {
    return noStoreJson({ code: "INVALID_ORIGIN" }, { status: 403 });
  }
  if (authorization.status === "password-required") {
    return noStoreJson({ code: "PASSWORD_REQUIRED" }, { status: 401 });
  }
  return noStoreJson({ code: "ROOM_UNAVAILABLE" }, { status: 404 });
}

/**
 * A single response for "this document is not available to you".
 *
 * Wrong room, unknown id, unfinished upload, and expired all return the same
 * shape so the endpoint cannot be used to probe which documents exist.
 */
export function documentUnavailable() {
  return noStoreJson(
    { code: "DOCUMENT_UNAVAILABLE", message: "This file is no longer available." },
    { status: 404 },
  );
}
