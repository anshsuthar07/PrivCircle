import { and, asc, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import { getDatabase } from "@/db";
import { lifetimeRooms, roomDocuments, type RoomDocumentRow } from "@/db/schema";
import { DOCUMENT_TTL_SECONDS, UPLOAD_WINDOW_SECONDS } from "./config";

/**
 * Document metadata queries.
 *
 * Every expiry comparison uses the database clock (`now()`), so listing,
 * downloading, and cleanup all agree on a single authoritative UTC instant and
 * a document cannot appear active to one request and expired to another.
 */

const activeFilter = sql`${roomDocuments.expiresAt} > now()`;

export interface ActiveDocument {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
  expiresAt: string;
}

function toActiveDocument(row: RoomDocumentRow): ActiveDocument {
  return {
    id: row.id,
    filename: row.originalFilename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

/**
 * Reserves a storage key before any bytes exist.
 *
 * `expiresAt` is derived from the database clock so the 24-hour lifetime can
 * never be shifted by a client, and `sizeBytes` holds the declared size as a
 * quota reservation until `markDocumentReady` replaces it with the true size.
 */
export async function createPendingDocument(input: {
  documentId: string;
  roomId: string;
  roomPath: string;
  storageKey: string;
  filename: string;
  contentType: string;
  declaredSize: number;
  uploadedBy: string;
}) {
  const rows = await getDatabase()
    .insert(roomDocuments)
    .values({
      id: input.documentId,
      roomId: input.roomId,
      roomPath: input.roomPath,
      storageKey: input.storageKey,
      originalFilename: input.filename,
      contentType: input.contentType,
      sizeBytes: input.declaredSize,
      status: "pending",
      uploadedBy: input.uploadedBy,
      createdAt: sql`now()`,
      expiresAt: sql`now() + make_interval(secs => ${DOCUMENT_TTL_SECONDS})`,
    })
    .returning();
  return rows[0] ?? null;
}

/** Loads a row scoped to its room. Room ownership is part of the predicate, never a later check. */
export async function findRoomDocument(input: {
  documentId: string;
  roomId: string;
}): Promise<RoomDocumentRow | null> {
  const rows = await getDatabase()
    .select()
    .from(roomDocuments)
    .where(
      and(
        eq(roomDocuments.id, input.documentId),
        eq(roomDocuments.roomId, input.roomId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Loads a document only if it belongs to the room, is finalized, and has not expired. */
export async function findDownloadableDocument(input: {
  documentId: string;
  roomId: string;
}): Promise<RoomDocumentRow | null> {
  const rows = await getDatabase()
    .select()
    .from(roomDocuments)
    .where(
      and(
        eq(roomDocuments.id, input.documentId),
        eq(roomDocuments.roomId, input.roomId),
        eq(roomDocuments.status, "ready"),
        activeFilter,
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Promotes a pending row once the object is confirmed in storage. Idempotent. */
export async function markDocumentReady(input: {
  documentId: string;
  roomId: string;
  sizeBytes: number;
  contentType: string;
}) {
  const rows = await getDatabase()
    .update(roomDocuments)
    .set({
      status: "ready",
      sizeBytes: input.sizeBytes,
      contentType: input.contentType,
    })
    .where(
      and(
        eq(roomDocuments.id, input.documentId),
        eq(roomDocuments.roomId, input.roomId),
        activeFilter,
      ),
    )
    .returning();
  return rows[0] ?? null;
}

/** Active documents for one room, filtered in SQL rather than in the client. */
export async function listRoomDocuments(roomId: string): Promise<ActiveDocument[]> {
  const rows = await getDatabase()
    .select()
    .from(roomDocuments)
    .where(
      and(
        eq(roomDocuments.roomId, roomId),
        eq(roomDocuments.status, "ready"),
        activeFilter,
      ),
    )
    .orderBy(asc(roomDocuments.createdAt));
  return rows.map(toActiveDocument);
}

/**
 * Everything the files panel needs, in one round trip.
 *
 * Listing and quota were two separate queries over the same rows, run on every
 * room open whether or not the panel was ever shown. They are the same
 * predicate, so they are the same query.
 */
export async function getRoomDocumentState(roomId: string) {
  const rows = await getDatabase()
    .select()
    .from(roomDocuments)
    .where(and(eq(roomDocuments.roomId, roomId), activeFilter))
    .orderBy(asc(roomDocuments.createdAt));

  return {
    documents: rows
      .filter((row) => row.status === "ready")
      .map(toActiveDocument),
    // Quota counts in-flight uploads too, so a reservation cannot be exceeded
    // by starting several at once.
    usage: {
      documents: rows.length,
      bytes: rows.reduce((total, row) => total + Number(row.sizeBytes), 0),
    },
  };
}

/** Count and reserved bytes for a room, including in-flight uploads. */
export async function getRoomUsage(roomId: string) {
  const rows = await getDatabase()
    .select({
      documents: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(${roomDocuments.sizeBytes}), 0)::bigint`,
    })
    .from(roomDocuments)
    .where(and(eq(roomDocuments.roomId, roomId), activeFilter));

  const row = rows[0];
  return {
    documents: Number(row?.documents ?? 0),
    bytes: Number(row?.bytes ?? 0),
  };
}

export async function deleteDocumentRow(documentId: string) {
  await getDatabase().delete(roomDocuments).where(eq(roomDocuments.id, documentId));
}

/**
 * Rows whose storage object should no longer exist: anything past its 24-hour
 * lifetime, plus uploads abandoned before finalization.
 */
export async function findReclaimableDocuments(limit: number) {
  return getDatabase()
    .select({ id: roomDocuments.id, storageKey: roomDocuments.storageKey })
    .from(roomDocuments)
    .where(
      or(
        lte(roomDocuments.expiresAt, sql`now()`),
        and(
          eq(roomDocuments.status, "pending"),
          lte(
            roomDocuments.createdAt,
            sql`now() - make_interval(secs => ${UPLOAD_WINDOW_SECONDS})`,
          ),
        ),
      ),
    )
    .orderBy(asc(roomDocuments.expiresAt))
    .limit(limit);
}

export async function deleteDocumentRows(ids: string[]) {
  if (ids.length === 0) return 0;
  const rows = await getDatabase()
    .delete(roomDocuments)
    .where(inArray(roomDocuments.id, ids))
    .returning({ id: roomDocuments.id });
  return rows.length;
}

/**
 * Marks a document expired immediately.
 *
 * Used when an early delete cannot reach storage: the row stops being listable
 * or downloadable at once, and cleanup reclaims the object on a later pass.
 */
export async function expireDocumentNow(documentId: string) {
  await getDatabase()
    .update(roomDocuments)
    .set({ expiresAt: sql`now()` })
    .where(eq(roomDocuments.id, documentId));
}

/**
 * Rooms that still have live files, oldest activity first.
 *
 * Only rooms whose files have had time to settle are returned. A file uploaded
 * seconds ago into a brand-new room must never be considered orphaned just
 * because a lookup raced with room creation.
 */
export async function findRoomsWithLiveDocuments(limit: number, settleSeconds: number) {
  return getDatabase()
    .selectDistinct({ roomId: roomDocuments.roomId })
    .from(roomDocuments)
    .where(
      and(
        gt(roomDocuments.expiresAt, sql`now()`),
        lte(
          roomDocuments.createdAt,
          sql`now() - make_interval(secs => ${settleSeconds})`,
        ),
      ),
    )
    .limit(limit);
}

/** Which of the given room ids are durable Lifetime rooms. */
export async function findExistingLifetimeRoomIds(roomIds: string[]) {
  if (roomIds.length === 0) return new Set<string>();
  const rows = await getDatabase()
    .select({ id: lifetimeRooms.id })
    .from(lifetimeRooms)
    .where(inArray(lifetimeRooms.id, roomIds));
  return new Set(rows.map((row) => row.id));
}

/**
 * Retires every live file belonging to the given rooms.
 *
 * Expiry is moved to the database clock rather than deleting rows, so the files
 * stop being listable and downloadable immediately and the existing reclaim
 * pass removes the bytes with all of its idempotency intact.
 */
export async function expireDocumentsForRooms(roomIds: string[]) {
  if (roomIds.length === 0) return 0;
  const rows = await getDatabase()
    .update(roomDocuments)
    .set({ expiresAt: sql`now()` })
    .where(
      and(inArray(roomDocuments.roomId, roomIds), gt(roomDocuments.expiresAt, sql`now()`)),
    )
    .returning({ id: roomDocuments.id });
  return rows.length;
}
