import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { isBlobConfigured } from "@/lib/documents/blob";
import { reclaimExpiredDocuments } from "@/lib/documents/cleanup";
import { noStoreJson, serviceError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorizedCron(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  // Fail closed: without a configured secret this endpoint does nothing at all.
  if (!secret) return false;

  const presented = request.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  const presentedBytes = Buffer.from(presented);
  const expectedBytes = Buffer.from(expected);
  if (presentedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(presentedBytes, expectedBytes);
}

/**
 * Scheduled reclamation of expired documents.
 *
 * The caller supplies no input whatsoever: which rows are eligible is decided
 * entirely by the database clock, so a request to this endpoint can never name
 * a document or storage key to delete. It is safe to run twice — a second pass
 * over the same rows deletes objects that are already gone and removes any rows
 * a previous pass could not.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return noStoreJson({ code: "UNAUTHORIZED" }, { status: 401 });
  }

  try {
    if (!isBlobConfigured()) {
      return noStoreJson({ code: "SERVICE_UNAVAILABLE" }, { status: 503 });
    }
    const result = await reclaimExpiredDocuments();
    return noStoreJson(result);
  } catch (error) {
    return serviceError(error, "cron.documents");
  }
}
