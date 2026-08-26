import { NextRequest } from "next/server";
import { createOrRefreshGrant } from "@/lib/auth/grants";
import { hashPassword } from "@/lib/auth/password";
import {
  attachSessionCookie,
  getOrCreateSessionToken,
  hashSessionToken,
} from "@/lib/auth/session";
import { noStoreJson, readSmallJson, serviceError } from "@/lib/http";
import { enforceRateLimit, requestSubject } from "@/lib/security/rate-limit";
import { isTrustedOrigin } from "@/lib/security/origin";
import {
  createReservedRoom,
  releaseRoomReservation,
  reserveRoomPath,
  toSafeMetadata,
  type RoomReservation,
} from "@/lib/storage/rooms";
import {
  createRoomSchema,
  generateRoomPath,
  isValidRoomPath,
  normalizeRoomPath,
  RESERVED_PATHS,
} from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) {
    return noStoreJson({ code: "INVALID_ORIGIN" }, { status: 403 });
  }

  try {
    await enforceRateLimit({
      scope: "create",
      subject: requestSubject(request),
      limit: 10,
      windowSeconds: 60 * 60,
    });

    const parsed = createRoomSchema.safeParse(await readSmallJson(request));
    if (!parsed.success) {
      return noStoreJson(
        { code: "INVALID_INPUT", message: parsed.error.issues[0]?.message },
        { status: 400 },
      );
    }

    const requestedPath = parsed.data.path
      ? normalizeRoomPath(parsed.data.path)
      : null;
    if (
      requestedPath &&
      (!isValidRoomPath(requestedPath) || RESERVED_PATHS.has(requestedPath))
    ) {
      return noStoreJson(
        { code: "INVALID_PATH", message: "Choose a different room path." },
        { status: 400 },
      );
    }

    let path = requestedPath || generateRoomPath();
    let reservation: RoomReservation | null = null;

    if (requestedPath) {
      reservation = await reserveRoomPath(path);
    } else {
      for (let attempts = 0; !reservation && attempts < 5; attempts += 1) {
        path = generateRoomPath();
        reservation = await reserveRoomPath(path);
      }
    }

    if (!reservation) {
      return noStoreJson(
        { code: "ROOM_EXISTS", message: "Room already exists.", path },
        { status: 409 },
      );
    }

    let passwordHash: string | null;
    try {
      passwordHash = parsed.data.passwordProtected
        ? await hashPassword(parsed.data.password!)
        : null;
    } catch (error) {
      await releaseRoomReservation(reservation).catch(() => undefined);
      throw error;
    }

    let room = await createReservedRoom(
      {
        path,
        passwordHash,
        expiration: parsed.data.expiration,
      },
      reservation,
    );

    if (!requestedPath) {
      for (let attempts = 0; !room && attempts < 4; attempts += 1) {
        path = generateRoomPath();
        reservation = await reserveRoomPath(path);
        if (reservation) {
          room = await createReservedRoom(
            {
              path,
              passwordHash,
              expiration: parsed.data.expiration,
            },
            reservation,
          );
        }
      }
    }

    if (!room) {
      return noStoreJson(
        { code: "ROOM_EXISTS", message: "Room already exists.", path },
        { status: 409 },
      );
    }

    const sessionToken = getOrCreateSessionToken(request);
    await createOrRefreshGrant(room, hashSessionToken(sessionToken));
    const response = noStoreJson(await toSafeMetadata(room), { status: 201 });
    attachSessionCookie(response, sessionToken);
    return response;
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError || error instanceof RangeError) {
      return noStoreJson(
        { code: "INVALID_INPUT", message: "Request body is invalid." },
        { status: 400 },
      );
    }
    return serviceError(error);
  }
}

// Intentionally no GET handler: rooms are never listable.
