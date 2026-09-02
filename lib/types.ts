export const EXPIRATION_SECONDS = {
  "1h": 60 * 60,
  "24h": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  lifetime: null,
} as const;

export type ExpirationPolicy = keyof typeof EXPIRATION_SECONDS;

/**
 * How many distinct participants may hold a room at once.
 *
 * Shared rather than duplicated because it is enforced in a Lua script, stated
 * on the landing page, offered in the create form, and shown in the room
 * header. The limit used to exist only inside the script, so the first time
 * anyone learned about it was when someone was turned away.
 *
 * A seat is a held WebSocket, so this is also the main bound on concurrent
 * functions and on awareness traffic, which every participant receives. It is
 * configurable so the ceiling can be tuned against real usage without a code
 * change; an unset or nonsensical value falls back to the default.
 */
const DEFAULT_ROOM_CAPACITY = 10;

/**
 * Read from a `NEXT_PUBLIC_` variable on purpose.
 *
 * This value is enforced on the server, in a Lua script, and *displayed* in the
 * browser — the room header, the create form, and the security page all state
 * it. A server-only variable is replaced with `undefined` in the client bundle,
 * which would leave the server enforcing one number while the interface
 * promised another. Being inlined at build time, changing it needs a redeploy
 * rather than only an environment edit.
 */
function readCapacity() {
  const raw = Number(process.env.NEXT_PUBLIC_ROOM_CAPACITY);
  return Number.isSafeInteger(raw) && raw >= 2 ? raw : DEFAULT_ROOM_CAPACITY;
}

export const ROOM_CAPACITY = readCapacity();

export interface RoomRecord {
  id: string;
  path: string;
  passwordRequired: boolean;
  passwordHash: string | null;
  expiration: ExpirationPolicy;
  createdAt: string;
  lastActiveAt: string;
}

export interface SafeRoomMetadata {
  path: string;
  passwordRequired: boolean;
  expiration: ExpirationPolicy;
  expiresAt: string | null;
}

export interface AccessGrant {
  participantId: string;
  roomId: string;
  path: string;
}

export interface RoomAccessClaims extends AccessGrant {
  purpose: "room-access";
}

export interface RealtimeContext extends AccessGrant {
  socketId: string;
  displayName: string;
  color: string;
}
