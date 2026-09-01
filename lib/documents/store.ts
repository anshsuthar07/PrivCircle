import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { getDatabase } from "@/db";
import { roomDocuments, type RoomDocumentRow } from "@/db/schema";
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
