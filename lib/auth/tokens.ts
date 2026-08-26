import { SignJWT, jwtVerify } from "jose";
import { getRequiredEnv } from "@/lib/config";
import type { AccessGrant, RoomAccessClaims } from "@/lib/types";

const issuer = "privcircle";
const audience = "privcircle-realtime";

function secret() {
  const value = getRequiredEnv("ROOM_TOKEN_SECRET");
  if (value.length < 32) {
    throw new Error("ROOM_TOKEN_SECRET must be at least 32 characters.");
  }
  return new TextEncoder().encode(value);
}

export async function issueRoomAccessToken(grant: AccessGrant) {
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const token = await new SignJWT({
    purpose: "room-access",
    roomId: grant.roomId,
    path: grant.path,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(grant.participantId)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret());

  return { token, expiresAt, participantId: grant.participantId };
}

export async function verifyRoomAccessToken(token: string) {
  const { payload } = await jwtVerify(token, secret(), {
    issuer,
    audience,
    algorithms: ["HS256"],
  });

  if (
    payload.purpose !== "room-access" ||
    typeof payload.roomId !== "string" ||
    typeof payload.path !== "string" ||
    typeof payload.sub !== "string"
  ) {
    throw new Error("Invalid room access token.");
  }

  return {
    purpose: "room-access",
    roomId: payload.roomId,
    path: payload.path,
    participantId: payload.sub,
  } satisfies RoomAccessClaims;
}
