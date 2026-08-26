import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  issueRoomAccessToken,
  verifyRoomAccessToken,
} from "@/lib/auth/tokens";

describe("room credentials", () => {
  it("uses the required Argon2id cost and never embeds plaintext", async () => {
    const password = "correct horse battery staple";
    const hash = await hashPassword(password);
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,(?:p=1,t=2|t=2,p=1)\$/);
    expect(hash).not.toContain(password);
    await expect(verifyPassword(hash, password)).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong password")).resolves.toBe(false);
  });

  it("binds short-lived access tokens to one room and participant", async () => {
    const grant = {
      roomId: crypto.randomUUID(),
      path: "token-room",
      participantId: crypto.randomUUID(),
    };
    const issued = await issueRoomAccessToken(grant);
    const claims = await verifyRoomAccessToken(issued.token);
    expect(claims).toMatchObject({ ...grant, purpose: "room-access" });
    expect(issued.expiresAt.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    await expect(
      verifyRoomAccessToken(`${issued.token.slice(0, -2)}xx`),
    ).rejects.toThrow();
  });
});
