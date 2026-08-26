import { NextRequest } from "next/server";
import { noStoreJson, serviceError } from "@/lib/http";
import { enforceRateLimit, requestSubject } from "@/lib/security/rate-limit";
import { lookupRoom, toSafeMetadata } from "@/lib/storage/rooms";
import { isValidRoomPath, normalizeRoomPath } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string }> },
) {
  const path = normalizeRoomPath((await context.params).path);
  if (!isValidRoomPath(path)) {
    return noStoreJson({ code: "ROOM_UNAVAILABLE" }, { status: 404 });
  }

  try {
    await enforceRateLimit({
      scope: "metadata",
      subject: requestSubject(request),
      limit: 60,
      windowSeconds: 60,
    });
    const lookup = await lookupRoom(path);
    if (lookup.status === "expired") {
      return noStoreJson({ code: "ROOM_EXPIRED" }, { status: 410 });
    }
    if (lookup.status === "missing") {
      return noStoreJson({ code: "ROOM_UNAVAILABLE" }, { status: 404 });
    }
    return noStoreJson(await toSafeMetadata(lookup.room));
  } catch (error) {
    return serviceError(error);
  }
}
