import { reportError } from "@/lib/observability";
import { getRedis } from "@/lib/redis";
import { keys } from "@/lib/storage/keys";
import { deleteStoredObject } from "./blob";
import { cleanupBatchSize } from "./config";
import {
  deleteDocumentRows,
  expireDocumentsForRooms,
  findExistingLifetimeRoomIds,
  findReclaimableDocuments,
  findRoomsWithLiveDocuments,
} from "./store";

/**
 * Reclaims expired documents from storage and then from the database.
 *
 * The order is deliberate and makes the job idempotent under partial failure:
 *
 * - Storage object deleted, row delete fails → the next pass selects the same
 *   row, deleting an already-missing object succeeds, and the row is removed.
 * - Storage delete fails → the row is left in place and retried next pass. It
 *   is already invisible to listing and download because both filter on
 *   `expires_at`, so a delayed reclaim never means delayed inaccessibility.
 *
 * One unreachable object therefore cannot block the rest of the batch.
 */
export interface CleanupResult {
  examined: number;
  removed: number;
  storageFailures: number;
  orphanedRetired: number;
}

/**
 * How long a file must exist before its room's absence counts as evidence.
 *
 * Guards against a lookup racing room creation, and against a brief storage
 * blip being read as "this room is gone".
 */
const ORPHAN_SETTLE_SECONDS = 15 * 60;
const ORPHAN_ROOM_BATCH = 200;

/**
 * Whether this deployment may retire another room's files.
 *
 * Preview deployments can be pointed at the same blob store and database as
 * production — they are here — so a preview opening a files panel would
 * otherwise start expiring real rooms' documents. Reclaiming objects that are
 * *already* expired is long-standing behaviour and stays; deciding that a room
 * is dead is new, destructive, and belongs to production alone.
 *
 * `RECLAIM_ORPHANED_DOCUMENTS=true` opts a non-production deployment in.
 */
function mayRetireOrphans() {
  if (process.env.RECLAIM_ORPHANED_DOCUMENTS === "true") return true;
  const environment = process.env.VERCEL_ENV;
  return !environment || environment === "production";
}

/**
 * Retires files whose room no longer exists.
 *
 * A file's own 24-hour lifetime is independent of its room's retention, which
 * means a one-hour room's files outlived the room itself by up to 23 hours.
 * Nobody could reach them — every endpoint resolves the room first — but the
 * bytes were still stored, which is not what someone choosing a one-hour room
 * is asking for.
 *
 * This fails closed in both directions: a room is only treated as gone when
 * Redis answers *and* PostgreSQL confirms it is not a Lifetime room, and any
 * error abandons the pass rather than retiring anything on incomplete evidence.
 */
export async function retireOrphanedDocuments(): Promise<number> {
  if (!mayRetireOrphans()) return 0;

  const rooms = await findRoomsWithLiveDocuments(
    ORPHAN_ROOM_BATCH,
    ORPHAN_SETTLE_SECONDS,
  );
  if (rooms.length === 0) return 0;

  const redis = getRedis();
  const pipeline = redis.pipeline();
  for (const room of rooms) pipeline.exists(keys.room(room.roomId));
  const results = await pipeline.exec();

  // A partial or failed pipeline is not evidence of anything.
  if (!results || results.length !== rooms.length) return 0;

  const candidates: string[] = [];
  results.forEach(([error, value], index) => {
    if (error) return;
    if (Number(value) === 0) candidates.push(rooms[index].roomId);
  });
  if (candidates.length === 0) return 0;

  // A Lifetime room is durable in PostgreSQL and may simply have aged out of
  // the Redis cache, so its absence there proves nothing on its own.
  const durable = await findExistingLifetimeRoomIds(candidates);
  const orphaned = candidates.filter((roomId) => !durable.has(roomId));
  return expireDocumentsForRooms(orphaned);
}

export async function reclaimExpiredDocuments(
  limit = cleanupBatchSize(),
): Promise<CleanupResult> {
  let orphanedRetired = 0;
  try {
    // Runs first so anything it retires is reclaimed by this same pass.
    orphanedRetired = await retireOrphanedDocuments();
  } catch (error) {
    reportError("documents.retireOrphaned", error);
  }

  const candidates = await findReclaimableDocuments(limit);
  const reclaimed: string[] = [];
  let storageFailures = 0;

  for (const candidate of candidates) {
    if (await deleteStoredObject(candidate.storageKey)) {
      reclaimed.push(candidate.id);
    } else {
      storageFailures += 1;
    }
  }

  const removed = await deleteDocumentRows(reclaimed);
  return { examined: candidates.length, removed, storageFailures, orphanedRetired };
}

const SWEEP_INTERVAL_SECONDS = 300;

/**
 * Best-effort reclaim triggered by room activity.
 *
 * The scheduled job is the durable guarantee; this only shortens the window
 * between a document expiring and its bytes disappearing. A Redis lock keeps it
 * to one run per interval across every instance, and any failure is swallowed
 * because the caller's response must not depend on it.
 */
export async function sweepExpiredDocuments() {
  try {
    const acquired = await getRedis().set(
      keys.documentSweep(),
      "1",
      "EX",
      SWEEP_INTERVAL_SECONDS,
      "NX",
    );
    if (acquired !== "OK") return null;
    return await reclaimExpiredDocuments();
  } catch (error) {
    reportError("documents.sweep", error);
    return null;
  }
}
