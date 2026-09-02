import { NextRequest } from "next/server";
import { createOrRefreshGrant } from "@/lib/auth/grants";
import { hashPassword } from "@/lib/auth/password";
import {
  attachSessionCookie,
  getOrCreateSessionToken,
  hashSessionToken,
} from "@/lib/auth/session";
import { noStoreJson, readSmallJson, serviceError } from "@/lib/http";
import {
  enforceRateLimit,
  peekRateLimit,
  requestSubject,
} from "@/lib/security/rate-limit";
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

/**
 * Two budgets, because they answer different questions.
 *
 * `create-attempt` is abuse control and counts every request, well-formed or
 * not. `create` is the product limit and is only spent when a room is actually
 * created. Charging the product limit up front meant a handful of mistyped room
 * names — or collisions on a name someone else had already taken — locked a
 * person out of creating anything for an hour, which is a punishment for using
 * the form rather than for abusing it.
 */
const CREATE_ATTEMPT_LIMIT = 40;
const CREATE_LIMIT = 10;
const CREATE_WINDOW_SECONDS = 60 * 60;

export async function POST(request: NextRequest) {
  if (!isTrustedOrigin(request)) {
    return noStoreJson({ code: "INVALID_ORIGIN" }, { status: 403 });
  }

  const subject = requestSubject(request);

  try {
    await enforceRateLimit({
      scope: "create-attempt",
      subject,
      limit: CREATE_ATTEMPT_LIMIT,
      windowSeconds: CREATE_WINDOW_SECONDS,
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

    // Checked before anything is reserved so the ceiling still holds, but only
    // charged below once a room really exists.
    await peekRateLimit({ scope: "create", subject, limit: CREATE_LIMIT });

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

    await enforceRateLimit({
      scope: "create",
      subject,
      limit: CREATE_LIMIT,
      windowSeconds: CREATE_WINDOW_SECONDS,
    }).catch(() => undefined);

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
    return serviceError(error, "rooms.create");
  }
}

// Intentionally no GET handler: rooms are never listable.
