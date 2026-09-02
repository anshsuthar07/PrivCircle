import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isValidRoomPath, normalizeRoomPath } from "@/lib/path-policy";
import { RoomClient } from "./RoomClient";

export const dynamic = "force-dynamic";

/**
 * This segment sits at the root, so it receives every single-segment URL —
 * including `/robots.txt`, `/favicon.ico`, and whatever a scanner is probing
 * for. Those used to render the room shell and answer `200 OK`, which is wrong
 * twice over: the status lies, and a crawler is handed a page instead of a
 * refusal.
 *
 * Rejecting anything that cannot be a room path costs no I/O — it is a shape
 * check, not a lookup — so a URL that was never a room is a plain 404 and never
 * reaches storage. A well-formed path that simply has no room behind it is
 * still resolved by the client, which can tell "gone" from "never existed".
 */
function roomPathFrom(raw: string) {
  const path = normalizeRoomPath(raw);
  return isValidRoomPath(path) ? path : null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ roomPath: string }>;
}): Promise<Metadata> {
  const { roomPath } = await params;
  const path = roomPathFrom(roomPath);
  return {
    title: path ? `/${path} — PrivCircle` : "Not found — PrivCircle",
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomPath: string }>;
}) {
  const { roomPath } = await params;
  const path = roomPathFrom(roomPath);
  if (!path) notFound();
  return <RoomClient path={path} />;
}
