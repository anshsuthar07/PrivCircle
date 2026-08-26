import { getRedis } from "@/lib/redis";
import {
  EXPIRATION_SECONDS,
  type AccessGrant,
  type RoomRecord,
} from "@/lib/types";
import { keys } from "@/lib/storage/keys";

const SESSION_SECONDS = 7 * 24 * 60 * 60;

function grantTtl(room: RoomRecord) {
  const roomTtl = EXPIRATION_SECONDS[room.expiration];
  return roomTtl === null ? SESSION_SECONDS : Math.min(roomTtl, SESSION_SECONDS);
}

export async function getGrant(room: RoomRecord, sessionHash: string) {
  const value = await getRedis().get(keys.grant(room.id, sessionHash));
  if (!value) return null;
  try {
    const grant = JSON.parse(value) as AccessGrant;
    return grant.roomId === room.id && grant.path === room.path ? grant : null;
  } catch {
    return null;
  }
}

export async function createOrRefreshGrant(
  room: RoomRecord,
  sessionHash: string,
) {
  const existing = await getGrant(room, sessionHash);
  const grant: AccessGrant =
    existing || {
      participantId: crypto.randomUUID(),
      roomId: room.id,
      path: room.path,
    };

  await getRedis().set(
    keys.grant(room.id, sessionHash),
    JSON.stringify(grant),
    "EX",
    grantTtl(room),
  );
  return grant;
}
