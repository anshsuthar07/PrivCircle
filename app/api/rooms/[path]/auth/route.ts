import { NextRequest } from "next/server";
import { createOrRefreshGrant } from "@/lib/auth/grants";
import { verifyDummyPassword, verifyPassword } from "@/lib/auth/password";
import {
  attachSessionCookie,
  getOrCreateSessionToken,
  hashSessionToken,
} from "@/lib/auth/session";
import { issueRoomAccessToken } from "@/lib/auth/tokens";
import { noStoreJson, readSmallJson, serviceError } from "@/lib/http";
import { isTrustedOrigin } from "@/lib/security/origin";
import { enforceRateLimit, requestSubject } from "@/lib/security/rate-limit";
import { getRoom, touchRoom } from "@/lib/storage/rooms";
import { authRoomSchema, isValidRoomPath, normalizeRoomPath } from "@/lib/validation";

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
    return noStoreJson(
      { code: "AUTH_FAILED", message: "Incorrect password. Please try again." },
      { status: 401 },
    );
  }

  try {
    const subject = requestSubject(request);
    await Promise.all([
      enforceRateLimit({
        scope: "auth-global",
        subject,
        limit: 30,
        windowSeconds: 10 * 60,
      }),
      enforceRateLimit({
        scope: "auth-room",
        subject: `${subject}:${path}`,
        limit: 5,
        windowSeconds: 10 * 60,
      }),
    ]);
    const parsed = authRoomSchema.safeParse(await readSmallJson(request));
    if (!parsed.success) {
      return noStoreJson(
        { code: "AUTH_FAILED", message: "Incorrect password. Please try again." },
        { status: 401 },
      );
    }

    const room = await getRoom(path);
    if (!room || !room.passwordHash) {
      await verifyDummyPassword(parsed.data.password);
      return noStoreJson(
        { code: "AUTH_FAILED", message: "Incorrect password. Please try again." },
        { status: 401 },
      );
    }

    if (!(await verifyPassword(room.passwordHash, parsed.data.password))) {
      return noStoreJson(
        { code: "AUTH_FAILED", message: "Incorrect password. Please try again." },
        { status: 401 },
      );
    }

    const sessionToken = getOrCreateSessionToken(request);
    const grant = await createOrRefreshGrant(room, hashSessionToken(sessionToken));
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
    if (error instanceof SyntaxError || error instanceof TypeError || error instanceof RangeError) {
      return noStoreJson(
        { code: "AUTH_FAILED", message: "Incorrect password. Please try again." },
        { status: 401 },
      );
    }
    return serviceError(error);
  }
}
