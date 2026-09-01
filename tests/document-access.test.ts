import { afterAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { createOrRefreshGrant } from "@/lib/auth/grants";
import { hashPassword } from "@/lib/auth/password";
import { authorizeRoomRequest } from "@/lib/auth/room-access";
import { getSessionCookieName, hashSessionToken } from "@/lib/auth/session";
import { getRedis } from "@/lib/redis";
import { createRoom } from "@/lib/storage/rooms";
import { keys } from "@/lib/storage/keys";

/**
 * Document endpoints have no authorization of their own: they all funnel
 * through `authorizeRoomRequest`. These cover that single gate, which is what
 * decides whether a participant may list, upload, download, or delete files.
 */

const ORIGIN = "http://localhost:3000";
const createdPaths: string[] = [];

function roomPath() {
  const path = `docs-${randomBytes(6).toString("hex")}`;
  createdPaths.push(path);
  return path;
}

function newSession() {
  return randomBytes(32).toString("base64url");
}

function request(path: string, options: { origin?: string; session?: string } = {}) {
  const headers = new Headers({ origin: options.origin ?? ORIGIN });
  if (options.session) {
    headers.set("cookie", `${getSessionCookieName()}=${options.session}`);
  }
  return new NextRequest(`${ORIGIN}/api/rooms/${path}/documents`, { headers });
}

afterAll(async () => {
  const redis = getRedis();
  for (const path of createdPaths) {
    const roomId = await redis.get(keys.path(path));
    if (roomId) await redis.del(keys.room(roomId), keys.document(roomId));
    await redis.del(keys.path(path), keys.tombstone(path));
  }
  redis.disconnect();
});

describe("document authorization", () => {
  it("admits a participant to an open room and gives them an identity", async () => {
    const path = roomPath();
    await createRoom({ path, passwordHash: null, expiration: "1h" });

    const authorization = await authorizeRoomRequest(request(path), path);

    expect(authorization.status).toBe("authorized");
    if (authorization.status !== "authorized") return;
    expect(authorization.room.path).toBe(path);
    expect(authorization.grant.participantId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("keeps one session on the same identity, so file ownership is stable", async () => {
    const path = roomPath();
    await createRoom({ path, passwordHash: null, expiration: "1h" });
    const session = newSession();

    const first = await authorizeRoomRequest(request(path, { session }), path);
    const second = await authorizeRoomRequest(request(path, { session }), path);
    const stranger = await authorizeRoomRequest(
      request(path, { session: newSession() }),
      path,
    );

    if (
      first.status !== "authorized" ||
      second.status !== "authorized" ||
      stranger.status !== "authorized"
    ) {
      throw new Error("Expected all three requests to be authorized.");
    }
    expect(second.grant.participantId).toBe(first.grant.participantId);
    expect(stranger.grant.participantId).not.toBe(first.grant.participantId);
  });

  it("refuses a protected room until the password grant exists", async () => {
    const path = roomPath();
    await createRoom({
      path,
      passwordHash: await hashPassword("correct horse battery staple"),
      expiration: "1h",
    });
    const session = newSession();

    // The late-join guard: no grant means no files, exactly as it means no editor.
    const blocked = await authorizeRoomRequest(request(path, { session }), path);
    expect(blocked.status).toBe("password-required");

    // A grant is what the password endpoint issues on a correct password.
    const redis = getRedis();
    const roomId = await redis.get(keys.path(path));
    const stored = JSON.parse((await redis.get(keys.room(roomId!)))!);
    await createOrRefreshGrant(stored, hashSessionToken(session));

    const admitted = await authorizeRoomRequest(request(path, { session }), path);
    expect(admitted.status).toBe("authorized");
  });

  it("does not carry a grant from one room into another", async () => {
    const open = roomPath();
    const locked = roomPath();
    await createRoom({ path: open, passwordHash: null, expiration: "1h" });
    await createRoom({
      path: locked,
      passwordHash: await hashPassword("another strong passphrase 1!"),
      expiration: "1h",
    });
    const session = newSession();

    const inOpenRoom = await authorizeRoomRequest(request(open, { session }), open);
    expect(inOpenRoom.status).toBe("authorized");

    // Same browser, same cookie, different room: the grant is keyed per room.
    const inLockedRoom = await authorizeRoomRequest(
      request(locked, { session }),
      locked,
    );
    expect(inLockedRoom.status).toBe("password-required");
  });

  it("treats an unknown or malformed room as unavailable", async () => {
    await expect(
      authorizeRoomRequest(request("no-such-room-here"), "no-such-room-here").then(
        (result) => result.status,
      ),
    ).resolves.toBe("unavailable");

    for (const path of ["..", "a/b", "ab", "api"]) {
      const result = await authorizeRoomRequest(request("placeholder"), path);
      expect(result.status).toBe("unavailable");
    }
  });

  it("rejects a cross-site request to a room it would otherwise admit", async () => {
    const path = roomPath();
    await createRoom({ path, passwordHash: null, expiration: "1h" });

    const foreign = await authorizeRoomRequest(
      request(path, { origin: "https://attacker.example" }),
      path,
    );
    expect(foreign.status).toBe("invalid-origin");

    // Downloads are navigations and carry no Origin, so they opt out of the
    // check and rely on the SameSite=Strict session cookie instead.
    const navigation = await authorizeRoomRequest(
      request(path, { origin: "https://attacker.example" }),
      path,
      { requireTrustedOrigin: false },
    );
    expect(navigation.status).toBe("authorized");
  });
});
