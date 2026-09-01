import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/db";
import { roomDocuments } from "@/db/schema";

const { deleteStoredObject } = vi.hoisted(() => ({
  // Typed with the key parameter so per-key failure can be simulated.
  deleteStoredObject: vi.fn(async (key: string) => Boolean(key)),
}));

// Cleanup is exercised against the real database; only the storage provider is
// substituted, so the ordering guarantees are tested rather than mocked away.
vi.mock("@/lib/documents/blob", () => ({
  deleteStoredObject,
  isBlobConfigured: () => true,
}));

const { reclaimExpiredDocuments } = await import("@/lib/documents/cleanup");
const { createPendingDocument, markDocumentReady } = await import(
  "@/lib/documents/store"
);
const { documentStorageKey } = await import("@/lib/documents/filenames");
const { getRedis } = await import("@/lib/redis");

const BATCH = 500;
const createdRoomIds: string[] = [];

async function seed(options: { expiredSecondsAgo?: number; pendingHoursAgo?: number } = {}) {
  const roomId = crypto.randomUUID();
  createdRoomIds.push(roomId);
  const documentId = crypto.randomUUID();
  const filename = "notes.pdf";
  const storageKey = documentStorageKey({ roomId, documentId, filename });

  await createPendingDocument({
    documentId,
    roomId,
    roomPath: `room-${roomId.slice(0, 8)}`,
    storageKey,
    filename,
    contentType: "application/pdf",
    declaredSize: 2048,
    uploadedBy: crypto.randomUUID(),
  });

  if (options.pendingHoursAgo === undefined) {
    await markDocumentReady({
      documentId,
      roomId,
      sizeBytes: 2048,
      contentType: "application/pdf",
    });
  }

  const patch: Record<string, Date> = {};
  if (options.expiredSecondsAgo !== undefined) {
    patch.expiresAt = new Date(Date.now() - options.expiredSecondsAgo * 1000);
  }
  if (options.pendingHoursAgo !== undefined) {
    patch.createdAt = new Date(Date.now() - options.pendingHoursAgo * 3_600_000);
  }
  if (Object.keys(patch).length > 0) {
    await getDatabase()
      .update(roomDocuments)
      .set(patch)
      .where(eq(roomDocuments.id, documentId));
  }

  return { documentId, storageKey };
}

async function rowExists(documentId: string) {
  const rows = await getDatabase()
    .select({ id: roomDocuments.id })
    .from(roomDocuments)
    .where(eq(roomDocuments.id, documentId));
  return rows.length === 1;
}

beforeEach(() => {
  deleteStoredObject.mockReset();
  deleteStoredObject.mockImplementation(async (key: string) => Boolean(key));
});

afterAll(async () => {
  const database = getDatabase();
  for (const roomId of createdRoomIds) {
    await database.delete(roomDocuments).where(eq(roomDocuments.roomId, roomId));
  }
  getRedis().disconnect();
});

describe("expired document cleanup", () => {
  it("deletes the storage object and then the metadata row", async () => {
    const expired = await seed({ expiredSecondsAgo: 60 });

    await reclaimExpiredDocuments(BATCH);

    expect(deleteStoredObject).toHaveBeenCalledWith(expired.storageKey);
    await expect(rowExists(expired.documentId)).resolves.toBe(false);
  });

  it("leaves documents that have not expired untouched", async () => {
    const active = await seed();

    await reclaimExpiredDocuments(BATCH);

    expect(deleteStoredObject).not.toHaveBeenCalledWith(active.storageKey);
    await expect(rowExists(active.documentId)).resolves.toBe(true);
  });

  it("reclaims uploads abandoned before finalization", async () => {
    const abandoned = await seed({ pendingHoursAgo: 3 });

    await reclaimExpiredDocuments(BATCH);

    expect(deleteStoredObject).toHaveBeenCalledWith(abandoned.storageKey);
    await expect(rowExists(abandoned.documentId)).resolves.toBe(false);
  });

  it("is safe to run twice over the same documents", async () => {
    const expired = await seed({ expiredSecondsAgo: 60 });

    await reclaimExpiredDocuments(BATCH);
    deleteStoredObject.mockClear();

    // The second pass must neither throw nor revisit work the first completed.
    const second = await reclaimExpiredDocuments(BATCH);

    expect(deleteStoredObject).not.toHaveBeenCalledWith(expired.storageKey);
    expect(second.storageFailures).toBe(0);
    await expect(rowExists(expired.documentId)).resolves.toBe(false);
  });

  it("keeps the row when storage deletion fails, and recovers on the next run", async () => {
    const stubborn = await seed({ expiredSecondsAgo: 60 });
    deleteStoredObject.mockImplementation(async (key: string) =>
      key !== stubborn.storageKey,
    );

    const first = await reclaimExpiredDocuments(BATCH);
    expect(first.storageFailures).toBeGreaterThanOrEqual(1);
    // The object may still exist, so the row is deliberately retained.
    await expect(rowExists(stubborn.documentId)).resolves.toBe(true);

    deleteStoredObject.mockImplementation(async (key: string) => Boolean(key));
    await reclaimExpiredDocuments(BATCH);

    await expect(rowExists(stubborn.documentId)).resolves.toBe(false);
  });

  it("removes a row whose object is already gone", async () => {
    // This is the recovery path when a previous pass deleted the object but
    // could not delete the row: deleting a missing object reports success.
    const orphan = await seed({ expiredSecondsAgo: 60 });
    deleteStoredObject.mockImplementation(async (key: string) => Boolean(key));

    await reclaimExpiredDocuments(BATCH);

    await expect(rowExists(orphan.documentId)).resolves.toBe(false);
  });

  it("does not let one unreachable object block the rest of the batch", async () => {
    const broken = await seed({ expiredSecondsAgo: 120 });
    const healthy = await seed({ expiredSecondsAgo: 120 });
    deleteStoredObject.mockImplementation(async (key: string) =>
      key !== broken.storageKey,
    );

    await reclaimExpiredDocuments(BATCH);

    await expect(rowExists(broken.documentId)).resolves.toBe(true);
    await expect(rowExists(healthy.documentId)).resolves.toBe(false);
  });
});
