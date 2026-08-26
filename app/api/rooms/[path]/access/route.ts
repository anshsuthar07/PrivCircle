import { NextRequest } from "next/server";
import { createOrRefreshGrant, getGrant } from "@/lib/auth/grants";
import {
  attachSessionCookie,
  getOrCreateSessionToken,
  hashSessionToken,
} from "@/lib/auth/session";
import { issueRoomAccessToken } from "@/lib/auth/tokens";
import { noStoreJson, serviceError } from "@/lib/http";
import { isTrustedOrigin } from "@/lib/security/origin";
import { enforceRateLimit, requestSubject } from "@/lib/security/rate-limit";
import { getRoom, touchRoom } from "@/lib/storage/rooms";
import { isValidRoomPath, normalizeRoomPath } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string }> },
) {
  if (!isTrustedOrigin(request)) {
    return noStoreJson({ code: "INVALID_ORIGIN" }, { status: 403 });
  }
  const path = normalizeRoomPath((await context.params).path);
  if (!isValidRoomPath(path)) {
    return noStoreJson({ code: "ROOM_UNAVAILABLE" }, { status: 404 });
  }

  try {
    await enforceRateLimit({
      scope: "access",
      subject: requestSubject(request),
      limit: 60,
      windowSeconds: 60,
    });
    const room = await getRoom(path);
    if (!room) {
      return noStoreJson({ code: "ROOM_UNAVAILABLE" }, { status: 404 });
    }

    const sessionToken = getOrCreateSessionToken(request);
    const sessionHash = hashSessionToken(sessionToken);
    let grant = await getGrant(room, sessionHash);
    if (room.passwordRequired && !grant) {
      return noStoreJson({ code: "PASSWORD_REQUIRED" }, { status: 401 });
    }
    grant = await createOrRefreshGrant(room, sessionHash);

    const access = await issueRoomAccessToken(grant);
    await touchRoom(room);
    const response = noStoreJson({
      accessToken: access.token,
      tokenExpiresAt: access.expiresAt.toISOString(),
      participantId: access.participantId,
    });
    attachSessionCookie(response, sessionToken);
    return response;
  } catch (error) {
    return serviceError(error);
  }
}
