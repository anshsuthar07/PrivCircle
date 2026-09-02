import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as Y from "yjs";
import { getDatabase } from "@/db";
import { lifetimeRooms } from "@/db/schema";
import { getRedis } from "@/lib/redis";
import { keys } from "@/lib/storage/keys";
import {
  createRoom,
  DocumentTooLargeError,
  loadDocument,
  MAX_DOCUMENT_STATE_BYTES,
  storeDocument,
  touchRoom,
} from "@/lib/storage/rooms";

const createdPaths: string[] = [];

async function makeRoom(expiration: "1h" | "lifetime") {
  const path = `limit-${crypto.randomUUID().slice(0, 8)}`;
  createdPaths.push(path);
  const room = await createRoom({ path, passwordHash: null, expiration });
  expect(room).not.toBeNull();
  return room!;
}

/** A Yjs update guaranteed to exceed the ceiling. */
function oversizedState() {
  const doc = new Y.Doc();
  doc.getText("content").insert(0, "x".repeat(MAX_DOCUMENT_STATE_BYTES + 4096));
  return Y.encodeStateAsUpdate(doc);
}

afterAll(async () => {
  const database = getDatabase();
  for (const path of createdPaths) {
    const rooms = await database
      .select({ id: lifetimeRooms.id })
      .from(lifetimeRooms)
      .where(eq(lifetimeRooms.path, path));
    for (const room of rooms) {
      await database.delete(lifetimeRooms).where(eq(lifetimeRooms.id, room.id));
      await getRedis().del(keys.room(room.id), keys.document(room.id));
    }
    await getRedis().del(keys.path(path));
  }
  getRedis().disconnect();
});

describe.sequential("document size ceiling", () => {
  it("refuses an oversized document with a type the realtime layer can act on", async () => {
    const room = await makeRoom("1h");
    await expect(storeDocument(room, oversizedState())).rejects.toBeInstanceOf(
      DocumentTooLargeError,
    );
  });

  it("leaves the last good state in place when a store is refused", async () => {
    const room = await makeRoom("1h");
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "kept");
    await storeDocument(room, Y.encodeStateAsUpdate(doc));

    await expect(storeDocument(room, oversizedState())).rejects.toBeInstanceOf(
      DocumentTooLargeError,
    );

    // The refusal must not have destroyed what was already stored — this is the
    // state a reload comes back to.
    const restored = new Y.Doc();
    Y.applyUpdate(restored, (await loadDocument(room))!);
    expect(restored.getText("content").toString()).toBe("kept");
  });
});

describe.sequential("lifetime room caching", () => {
  /**
   * Lifetime rooms are durable in PostgreSQL and only cached in Redis. They
   * used to be cached with no expiry at all, so every room ever created held
   * its metadata and up to a 1 MiB snapshot in Redis permanently. Every cached
   * key must now carry a bounded lifetime.
   */
  it("bounds every cached key so Redis cannot grow without limit", async () => {
    const room = await makeRoom("lifetime");
    const redis = getRedis();

    for (const key of [
      keys.path(room.path),
      keys.room(room.id),
      keys.document(room.id),
    ]) {
      const ttl = await redis.ttl(key);
      expect(ttl, `${key} must expire`).toBeGreaterThan(0);
    }
  });

  it("refreshes the cache window on activity", async () => {
    const room = await makeRoom("lifetime");
    const redis = getRedis();
    await redis.expire(keys.room(room.id), 60);
    expect(await redis.ttl(keys.room(room.id))).toBeLessThanOrEqual(60);

    await touchRoom(room);
    expect(await redis.ttl(keys.room(room.id))).toBeGreaterThan(60);
  });

  it("survives losing the cache entirely, because PostgreSQL is the source of truth", async () => {
    const room = await makeRoom("lifetime");
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "durable");
    await storeDocument(room, Y.encodeStateAsUpdate(doc));

    // Exactly what expiry does, only immediately.
    await getRedis().del(keys.path(room.path), keys.room(room.id), keys.document(room.id));

    const restored = new Y.Doc();
    Y.applyUpdate(restored, (await loadDocument(room))!);
    expect(restored.getText("content").toString()).toBe("durable");
    // And the rehydrated copy is bounded too, rather than restoring the leak.
    expect(await getRedis().ttl(keys.document(room.id))).toBeGreaterThan(0);
  });
});
