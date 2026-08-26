import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as Y from "yjs";
import { getDatabase } from "@/db";
import { lifetimeDocuments, lifetimeRooms } from "@/db/schema";
import { getRedis } from "@/lib/redis";
import {
  createRoom,
  loadDocument,
  releaseRoomReservation,
  reserveRoomPath,
  storeDocument,
} from "@/lib/storage/rooms";
import { keys } from "@/lib/storage/keys";

const createdPaths: string[] = [];

afterAll(async () => {
  const database = getDatabase();
  for (const path of createdPaths) {
    const rooms = await database
      .select({ id: lifetimeRooms.id })
      .from(lifetimeRooms)
      .where(eq(lifetimeRooms.path, path));
    for (const room of rooms) {
      await database.delete(lifetimeRooms).where(eq(lifetimeRooms.id, room.id));
      await getRedis().del(keys.path(path), keys.room(room.id), keys.document(room.id));
    }
  }
  getRedis().disconnect();
});

describe.sequential("hybrid persistence", () => {
  it("reserves paths atomically and releases failed creation attempts", async () => {
    const path = `reservation-${crypto.randomUUID().slice(0, 8)}`;
    const first = await reserveRoomPath(path);
    expect(first).not.toBeNull();
    await expect(reserveRoomPath(path)).resolves.toBeNull();

    await releaseRoomReservation(first!);
    const retried = await reserveRoomPath(path);
    expect(retried).not.toBeNull();
    await releaseRoomReservation(retried!);
    await expect(getRedis().exists(keys.path(path))).resolves.toBe(0);
  });

  it("keeps expiring rooms out of PostgreSQL", async () => {
    const path = `expiring-${crypto.randomUUID().slice(0, 8)}`;
    const room = await createRoom({ path, passwordHash: null, expiration: "1h" });
    expect(room).not.toBeNull();
    const rows = await getDatabase()
      .select()
      .from(lifetimeRooms)
      .where(eq(lifetimeRooms.path, path));
    expect(rows).toHaveLength(0);
    expect(await getRedis().ttl(keys.room(room!.id))).toBeGreaterThan(3500);
    await getRedis().del(
      keys.path(path),
      keys.room(room!.id),
      keys.document(room!.id),
      keys.tombstone(path),
    );
  });

  it("rehydrates lifetime Yjs state after Redis cache loss", async () => {
    const path = `lifetime-${crypto.randomUUID().slice(0, 8)}`;
    createdPaths.push(path);
    const room = await createRoom({ path, passwordHash: null, expiration: "lifetime" });
    expect(room).not.toBeNull();

    const source = new Y.Doc();
    source.getText("content").insert(0, "const durable = true;");
    await storeDocument(room!, Y.encodeStateAsUpdate(source));
    await getRedis().del(keys.document(room!.id));

    const recovered = await loadDocument(room!);
    const target = new Y.Doc();
    Y.applyUpdate(target, recovered!);
    expect(target.getText("content").toString()).toBe("const durable = true;");

    await getDatabase().delete(lifetimeRooms).where(eq(lifetimeRooms.id, room!.id));
    const documents = await getDatabase()
      .select()
      .from(lifetimeDocuments)
      .where(eq(lifetimeDocuments.roomId, room!.id));
    expect(documents).toHaveLength(0);
  });
});
