import { getRedis } from "@/lib/redis";
import { keys } from "@/lib/storage/keys";
import { deleteStoredObject } from "./blob";
import { cleanupBatchSize } from "./config";
import { deleteDocumentRows, findReclaimableDocuments } from "./store";

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
}

export async function reclaimExpiredDocuments(
  limit = cleanupBatchSize(),
): Promise<CleanupResult> {
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
  return { examined: candidates.length, removed, storageFailures };
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
  } catch {
    return null;
  }
}
