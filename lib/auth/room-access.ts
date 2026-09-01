import type { NextRequest, NextResponse } from "next/server";
import { createOrRefreshGrant, getGrant } from "@/lib/auth/grants";
import {
  attachSessionCookie,
  getOrCreateSessionToken,
  hashSessionToken,
} from "@/lib/auth/session";
import { isTrustedOrigin } from "@/lib/security/origin";
import { getRoom } from "@/lib/storage/rooms";
import type { AccessGrant, RoomRecord } from "@/lib/types";
import { isValidRoomPath, normalizeRoomPath } from "@/lib/validation";

/**
 * The single room authorization used by every room-scoped endpoint.
 *
 * This is the same sequence the room access endpoint has always run — resolve
 * the room, look for a grant bound to this session, and refuse protected rooms
 * that have no grant yet. Documents deliberately reuse it rather than
 * introducing a second, weaker check: the late-join guard that keeps a
 * protected room's editor closed also keeps its files closed.
 */

export type RoomAuthorization =
  | {
      status: "authorized";
      room: RoomRecord;
      grant: AccessGrant;
      sessionToken: string;
      path: string;
    }
  | { status: "invalid-origin" }
  | { status: "unavailable" }
  | { status: "password-required" };

export async function authorizeRoomRequest(
  request: NextRequest,
  rawPath: string,
  options: { requireTrustedOrigin?: boolean } = {},
): Promise<RoomAuthorization> {
  const requireTrustedOrigin = options.requireTrustedOrigin ?? true;
  if (requireTrustedOrigin && !isTrustedOrigin(request)) {
    return { status: "invalid-origin" };
  }

  const path = normalizeRoomPath(rawPath);
  if (!isValidRoomPath(path)) return { status: "unavailable" };

  const room = await getRoom(path);
  if (!room) return { status: "unavailable" };

  const sessionToken = getOrCreateSessionToken(request);
  const sessionHash = hashSessionToken(sessionToken);
  const existing = await getGrant(room, sessionHash);
  if (room.passwordRequired && !existing) {
    return { status: "password-required" };
  }

  const grant = await createOrRefreshGrant(room, sessionHash);
  return { status: "authorized", room, grant, sessionToken, path };
}

/** Keeps the anonymous session cookie rolling on authorized responses. */
export function withSession<T extends NextResponse>(response: T, sessionToken: string) {
  attachSessionCookie(response, sessionToken);
  return response;
}
