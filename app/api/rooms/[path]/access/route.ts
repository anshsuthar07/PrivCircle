import { NextRequest } from "next/server";
import { authorizeRoomRequest, withSession } from "@/lib/auth/room-access";
import { issueRoomAccessToken } from "@/lib/auth/tokens";
import { noStoreJson, serviceError } from "@/lib/http";
import { isTrustedOrigin } from "@/lib/security/origin";
import { enforceRateLimit, requestSubject } from "@/lib/security/rate-limit";
import { touchRoom } from "@/lib/storage/rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string }> },
) {
  if (!isTrustedOrigin(request)) {
    return noStoreJson({ code: "INVALID_ORIGIN" }, { status: 403 });
  }

  try {
    await enforceRateLimit({
      scope: "access",
      subject: requestSubject(request),
      limit: 60,
      windowSeconds: 60,
    });

    const authorization = await authorizeRoomRequest(
      request,
      (await context.params).path,
      { requireTrustedOrigin: false },
    );
    if (authorization.status === "password-required") {
      return noStoreJson({ code: "PASSWORD_REQUIRED" }, { status: 401 });
    }
    if (authorization.status !== "authorized") {
      return noStoreJson({ code: "ROOM_UNAVAILABLE" }, { status: 404 });
    }

    const access = await issueRoomAccessToken(authorization.grant);
    await touchRoom(authorization.room);
    return withSession(
      noStoreJson({
        accessToken: access.token,
        tokenExpiresAt: access.expiresAt.toISOString(),
        participantId: access.participantId,
      }),
      authorization.sessionToken,
    );
  } catch (error) {
    return serviceError(error, "rooms.access");
  }
}
