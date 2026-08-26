export const EXPIRATION_SECONDS = {
  "1h": 60 * 60,
  "24h": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  lifetime: null,
} as const;

export type ExpirationPolicy = keyof typeof EXPIRATION_SECONDS;

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
