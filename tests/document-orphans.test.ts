import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/db";
import { lifetimeRooms, roomDocuments } from "@/db/schema";

const { deleteStoredObject } = vi.hoisted(() => ({
  deleteStoredObject: vi.fn(async (key: string) => Boolean(key)),
}));

// Only the storage provider is substituted; the room lookup, the database, and
// Redis are all real, because the ordering between them is what is under test.
vi.mock("@/lib/documents/blob", () => ({
  deleteStoredObject,
  isBlobConfigured: () => true,
}));

const { retireOrphanedDocuments } = await import("@/lib/documents/cleanup");
const { createPendingDocument, markDocumentReady } = await import(
  "@/lib/documents/store"
);
const { documentStorageKey } = await import("@/lib/documents/filenames");
const { getRedis } = await import("@/lib/redis");
const { keys } = await import("@/lib/storage/keys");

const createdRoomIds: string[] = [];
const createdLifetimeIds: string[] = [];

/**
 * Seeds a live document old enough to be eligible.
 *
 * The reaper deliberately ignores anything younger than its settle window, so a
 * file uploaded seconds ago is never mistaken for an orphan while its room is
 * still being created.
 */
async function seedDocument(roomId: string, ageMinutes = 60) {
  createdRoomIds.push(roomId);
  const documentId = crypto.randomUUID();
  const storageKey = documentStorageKey({
    roomId,
    documentId,
    filename: "notes.txt",
  });
  await createPendingDocument({
    documentId,
    roomId,
    roomPath: `room-${roomId.slice(0, 8)}`,
    storageKey,
    filename: "notes.txt",
    contentType: "text/plain",
    declaredSize: 512,
    uploadedBy: crypto.randomUUID(),
  });
  await markDocumentReady({ documentId, roomId, sizeBytes: 512, contentType: "text/plain" });
  await getDatabase()
    .update(roomDocuments)
    .set({ createdAt: new Date(Date.now() - ageMinutes * 60_000) })
    .where(eq(roomDocuments.id, documentId));
  return documentId;
}

async function isLive(documentId: string) {
  const rows = await getDatabase()
    .select({ expiresAt: roomDocuments.expiresAt })
    .from(roomDocuments)
    .where(eq(roomDocuments.id, documentId));
  return rows[0] ? rows[0].expiresAt.getTime() > Date.now() : false;
}

beforeEach(() => {
  deleteStoredObject.mockReset();
  deleteStoredObject.mockImplementation(async (key: string) => Boolean(key));
});

afterAll(async () => {
  const database = getDatabase();
  for (const roomId of createdRoomIds) {
    await database.delete(roomDocuments).where(eq(roomDocuments.roomId, roomId));
    await getRedis().del(keys.room(roomId));
  }
  for (const id of createdLifetimeIds) {
    await database.delete(lifetimeRooms).where(eq(lifetimeRooms.id, id));
  }
  getRedis().disconnect();
});

describe.sequential("files left behind by a dead room", () => {
  it("does nothing on a preview deployment sharing production storage", async () => {
    const roomId = crypto.randomUUID();
    const documentId = await seedDocument(roomId);
    await getRedis().del(keys.room(roomId));

    vi.stubEnv("VERCEL_ENV", "preview");
    try {
      await expect(retireOrphanedDocuments()).resolves.toBe(0);
      expect(await isLive(documentId)).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }

    // ...and still acts once it is production.
    await retireOrphanedDocuments();
    expect(await isLive(documentId)).toBe(false);
  });

  it("retires files whose room no longer exists", async () => {
    const roomId = crypto.randomUUID();
    const documentId = await seedDocument(roomId);
    // No Redis key and no Lifetime row: the room is genuinely gone, which is
    // exactly the state a 1-hour room reaches an hour after everyone leaves.
    await getRedis().del(keys.room(roomId));

    expect(await isLive(documentId)).toBe(true);
    await retireOrphanedDocuments();
    expect(await isLive(documentId)).toBe(false);
  });

  it("leaves files belonging to a live room alone", async () => {
    const roomId = crypto.randomUUID();
    const documentId = await seedDocument(roomId);
    await getRedis().set(keys.room(roomId), JSON.stringify({ id: roomId }), "EX", 600);

    await retireOrphanedDocuments();
    expect(await isLive(documentId)).toBe(true);
  });

  it("does not mistake a cache miss on a Lifetime room for a dead room", async () => {
    // Lifetime rooms are now cached with a bounded TTL, so their absence from
    // Redis is expected and proves nothing on its own. PostgreSQL decides.
    const roomId = crypto.randomUUID();
    createdLifetimeIds.push(roomId);
    const now = new Date();
    await getDatabase().insert(lifetimeRooms).values({
      id: roomId,
      path: `orphan-${roomId.slice(0, 8)}`,
      passwordRequired: false,
      passwordHash: null,
      createdAt: now,
      updatedAt: now,
      lastActiveAt: now,
    });
    const documentId = await seedDocument(roomId);
    await getRedis().del(keys.room(roomId));

    await retireOrphanedDocuments();
    expect(await isLive(documentId)).toBe(true);
  });

  it("ignores files too new for their room's absence to mean anything", async () => {
    const roomId = crypto.randomUUID();
    // Inside the settle window: a lookup racing room creation must not delete.
    const documentId = await seedDocument(roomId, 1);
    await getRedis().del(keys.room(roomId));

    await retireOrphanedDocuments();
    expect(await isLive(documentId)).toBe(true);
  });
});
