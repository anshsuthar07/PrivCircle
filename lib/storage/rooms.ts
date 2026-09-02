import { and, eq } from "drizzle-orm";
import * as Y from "yjs";
import { getDatabase } from "@/db";
import { lifetimeDocuments, lifetimeRooms } from "@/db/schema";
import { getRedis } from "@/lib/redis";
import {
  EXPIRATION_SECONDS,
  type ExpirationPolicy,
  type RoomRecord,
  type SafeRoomMetadata,
} from "@/lib/types";
import { keys } from "./keys";

const TOMBSTONE_SECONDS = 24 * 60 * 60;

/**
 * How long a Lifetime room may sit in the Redis cache without being touched.
 *
 * Lifetime rooms are durable in PostgreSQL; Redis is only a cache in front of
 * it. Caching them with no expiry at all meant every Lifetime room ever created
 * held its metadata *and* up to a 1 MiB snapshot in Redis permanently, which a
 * small Redis plan cannot absorb. A bounded idle lifetime bounds that memory:
 * `lookupRoom()` already rehydrates from PostgreSQL on a miss, and
 * `loadDocument()` already falls back to the stored snapshot, so an evicted key
 * costs one query and is transparent to the caller. Every read and write
 * refreshes it, so an active room is never dropped mid-session.
 */
const LIFETIME_CACHE_SECONDS = 7 * 24 * 60 * 60;

/** The hard ceiling on a room's Yjs snapshot. */
export const MAX_DOCUMENT_STATE_BYTES = 1024 * 1024;

/**
 * Raised when a room's shared document outgrows its storage ceiling.
 *
 * This is deliberately its own type: the realtime layer has to tell the
 * difference between "storage is broken, retry" and "this document can never be
 * stored", because only the second one has to reach the people editing it.
 */
export class DocumentTooLargeError extends Error {
  constructor(readonly byteLength: number) {
    super("Document exceeds the 1 MiB room limit.");
    this.name = "DocumentTooLargeError";
  }
}

export type RoomLookup =
  | { status: "active"; room: RoomRecord }
  | { status: "expired" }
  | { status: "missing" };

function serializeRoom(room: RoomRecord) {
  return JSON.stringify(room);
}

function parseRoom(value: string | null): RoomRecord | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as RoomRecord;
    if (!parsed.id || !parsed.path || !parsed.expiration) return null;
    return parsed;
  } catch {
    return null;
  }
}

function lifetimeRowToRecord(
  row: typeof lifetimeRooms.$inferSelect,
): RoomRecord {
  return {
    id: row.id,
    path: row.path,
    passwordRequired: row.passwordRequired,
    passwordHash: row.passwordHash,
    expiration: "lifetime",
    createdAt: row.createdAt.toISOString(),
    lastActiveAt: row.lastActiveAt.toISOString(),
  };
}

async function findLifetimeRoom(path: string) {
  const rows = await getDatabase()
    .select()
    .from(lifetimeRooms)
    .where(eq(lifetimeRooms.path, path))
    .limit(1);
  return rows[0] ? lifetimeRowToRecord(rows[0]) : null;
}

async function cacheLifetimeRoom(room: RoomRecord) {
  const redis = getRedis();
  await redis
    .multi()
    .set(keys.path(room.path), room.id, "EX", LIFETIME_CACHE_SECONDS)
    .set(keys.room(room.id), serializeRoom(room), "EX", LIFETIME_CACHE_SECONDS)
    .exec();
}

export async function lookupRoom(path: string): Promise<RoomLookup> {
  const redis = getRedis();
  const roomId = await redis.get(keys.path(path));

  if (roomId && !roomId.startsWith("reservation:")) {
    const room = parseRoom(await redis.get(keys.room(roomId)));
    if (room) return { status: "active", room };
  }

  const lifetime = await findLifetimeRoom(path);
  if (lifetime) {
    await cacheLifetimeRoom(lifetime);
    return { status: "active", room: lifetime };
  }

  if (await redis.exists(keys.tombstone(path))) {
    return { status: "expired" };
  }

  return { status: "missing" };
}

export async function getRoom(path: string) {
  const lookup = await lookupRoom(path);
  return lookup.status === "active" ? lookup.room : null;
}

export async function toSafeMetadata(
  room: RoomRecord,
): Promise<SafeRoomMetadata> {
  let expiresAt: string | null = null;
  if (room.expiration !== "lifetime") {
    const ttl = await getRedis().pttl(keys.room(room.id));
    if (ttl > 0) expiresAt = new Date(Date.now() + ttl).toISOString();
  }

  return {
    path: room.path,
    passwordRequired: room.passwordRequired,
    expiration: room.expiration,
    expiresAt,
  };
}

async function compareAndDelete(key: string, value: string) {
  await getRedis().eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    1,
    key,
    value,
  );
}

export interface RoomReservation {
  path: string;
  value: string;
}

export async function reserveRoomPath(
  path: string,
): Promise<RoomReservation | null> {
  const reservation = `reservation:${crypto.randomUUID()}`;
  const reserved = await getRedis().set(
    keys.path(path),
    reservation,
    "EX",
    30,
    "NX",
  );
  return reserved === "OK" ? { path, value: reservation } : null;
}

export async function releaseRoomReservation(
  reservation: RoomReservation,
) {
  await compareAndDelete(keys.path(reservation.path), reservation.value);
}

function databaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? databaseErrorCode(error.cause) : undefined;
}

export async function createReservedRoom(input: {
  path: string;
  passwordHash: string | null;
  expiration: ExpirationPolicy;
}, reservation: RoomReservation) {
  const redis = getRedis();
  if (
    reservation.path !== input.path ||
    (await redis.get(keys.path(input.path))) !== reservation.value
  ) {
    return null;
  }

  const now = new Date();
  const room: RoomRecord = {
    id: crypto.randomUUID(),
    path: input.path,
    passwordRequired: Boolean(input.passwordHash),
    passwordHash: input.passwordHash,
    expiration: input.expiration,
    createdAt: now.toISOString(),
    lastActiveAt: now.toISOString(),
  };
  const emptyDocument = Y.encodeStateAsUpdate(new Y.Doc());
  let lifetimeCreated = false;

  try {
    if (await findLifetimeRoom(input.path)) {
      await releaseRoomReservation(reservation);
      return null;
    }

    if (input.expiration === "lifetime") {
      await getDatabase().transaction(async (transaction) => {
        await transaction.insert(lifetimeRooms).values({
          id: room.id,
          path: room.path,
          passwordRequired: room.passwordRequired,
          passwordHash: room.passwordHash,
          createdAt: now,
          updatedAt: now,
          lastActiveAt: now,
        });
        await transaction.insert(lifetimeDocuments).values({
          roomId: room.id,
          state: emptyDocument,
          updatedAt: now,
        });
      });
      lifetimeCreated = true;

      await redis
        .multi()
        .set(keys.path(room.path), room.id, "EX", LIFETIME_CACHE_SECONDS)
        .set(keys.room(room.id), serializeRoom(room), "EX", LIFETIME_CACHE_SECONDS)
        .set(
          keys.document(room.id),
          Buffer.from(emptyDocument),
          "EX",
          LIFETIME_CACHE_SECONDS,
        )
        .exec();
    } else {
      const ttl = EXPIRATION_SECONDS[input.expiration];
      await redis
        .multi()
        .set(keys.path(room.path), room.id, "EX", ttl)
        .set(keys.room(room.id), serializeRoom(room), "EX", ttl)
        .set(keys.document(room.id), Buffer.from(emptyDocument), "EX", ttl)
        .set(keys.tombstone(room.path), "1", "EX", ttl + TOMBSTONE_SECONDS)
        .exec();
    }

    return room;
  } catch (error) {
    if (lifetimeCreated) {
      await getDatabase()
        .delete(lifetimeRooms)
        .where(eq(lifetimeRooms.id, room.id))
        .catch(() => undefined);
    }
    await Promise.all([
      releaseRoomReservation(reservation).catch(() => undefined),
      compareAndDelete(keys.path(input.path), room.id).catch(() => undefined),
      redis.del(keys.room(room.id), keys.document(room.id)).catch(() => undefined),
    ]);
    if (databaseErrorCode(error) === "23505") return null;
    throw error;
  }
}

export async function createRoom(input: {
  path: string;
  passwordHash: string | null;
  expiration: ExpirationPolicy;
}) {
  const reservation = await reserveRoomPath(input.path);
  if (!reservation) return null;
  return createReservedRoom(input, reservation);
}

export async function loadDocument(room: RoomRecord) {
  const redis = getRedis();
  const cached = await redis.getBuffer(keys.document(room.id));
  if (cached) return new Uint8Array(cached);

  if (room.expiration !== "lifetime") return null;

  const rows = await getDatabase()
    .select({ state: lifetimeDocuments.state })
    .from(lifetimeDocuments)
    .where(eq(lifetimeDocuments.roomId, room.id))
    .limit(1);
  const state = rows[0]?.state ?? null;
  if (state) {
    await redis.set(
      keys.document(room.id),
      Buffer.from(state),
      "EX",
      LIFETIME_CACHE_SECONDS,
    );
  }
  return state;
}

export async function storeDocument(room: RoomRecord, state: Uint8Array) {
  if (state.byteLength > MAX_DOCUMENT_STATE_BYTES) {
    throw new DocumentTooLargeError(state.byteLength);
  }
  const redis = getRedis();
  const now = new Date();

  if (room.expiration === "lifetime") {
    await getDatabase().transaction(async (transaction) => {
      await transaction
        .insert(lifetimeDocuments)
        .values({ roomId: room.id, state, updatedAt: now })
        .onConflictDoUpdate({
          target: lifetimeDocuments.roomId,
          set: { state, updatedAt: now },
        });
      await transaction
        .update(lifetimeRooms)
        .set({ updatedAt: now, lastActiveAt: now })
        .where(
          and(eq(lifetimeRooms.id, room.id), eq(lifetimeRooms.path, room.path)),
        );
    });
    await redis.set(
      keys.document(room.id),
      Buffer.from(state),
      "EX",
      LIFETIME_CACHE_SECONDS,
    );
    return;
  }

  const ttl = EXPIRATION_SECONDS[room.expiration];
  await redis.set(keys.document(room.id), Buffer.from(state), "EX", ttl);
  await touchRoom(room);
}

export async function touchRoom(room: RoomRecord) {
  const now = new Date().toISOString();
  room.lastActiveAt = now;
  const redis = getRedis();

  if (room.expiration === "lifetime") {
    await redis
      .multi()
      .set(keys.path(room.path), room.id, "EX", LIFETIME_CACHE_SECONDS)
      .set(keys.room(room.id), serializeRoom(room), "EX", LIFETIME_CACHE_SECONDS)
      .expire(keys.document(room.id), LIFETIME_CACHE_SECONDS)
      .exec();
    return;
  }

  const ttl = EXPIRATION_SECONDS[room.expiration];
  await redis
    .multi()
    .set(keys.path(room.path), room.id, "EX", ttl)
    .set(keys.room(room.id), serializeRoom(room), "EX", ttl)
    .expire(keys.document(room.id), ttl)
    .set(keys.tombstone(room.path), "1", "EX", ttl + TOMBSTONE_SECONDS)
    .exec();
}
