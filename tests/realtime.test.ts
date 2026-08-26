import { afterAll, describe, expect, it } from "vitest";
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import { Server } from "@hocuspocus/server";
import { WebSocket } from "ws";
import * as Y from "yjs";
import { issueRoomAccessToken } from "@/lib/auth/tokens";
import { getRedis } from "@/lib/redis";
import { createRealtimeConfiguration } from "@/lib/realtime/server";
import {
  claimParticipant,
  refreshParticipant,
  releaseParticipant,
} from "@/lib/realtime/presence";
import { keys } from "@/lib/storage/keys";
import { createRoom, storeDocument } from "@/lib/storage/rooms";

afterAll(() => getRedis().disconnect());

describe("horizontally scaled realtime", () => {
  it("keeps two-person leases alive atomically and rejects a third participant", async () => {
    const roomId = crypto.randomUUID();
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    const third = crypto.randomUUID();
    const firstSocket = crypto.randomUUID();
    const reconnectSocket = crypto.randomUUID();
    const secondSocket = crypto.randomUUID();

    try {
      await expect(claimParticipant(roomId, first, firstSocket)).resolves.toBe(true);
      await expect(claimParticipant(roomId, first, reconnectSocket)).resolves.toBe(true);
      await expect(claimParticipant(roomId, second, secondSocket)).resolves.toBe(true);
      await expect(
        claimParticipant(roomId, third, crypto.randomUUID()),
      ).resolves.toBe(false);

      await getRedis().pexpire(keys.presence(roomId), 250);
      await expect(
        refreshParticipant(roomId, first, firstSocket),
      ).resolves.toBe(true);
      expect(await getRedis().pttl(keys.presence(roomId))).toBeGreaterThan(100_000);
    } finally {
      await Promise.all([
        releaseParticipant(roomId, first, firstSocket),
        releaseParticipant(roomId, first, reconnectSocket),
        releaseParticipant(roomId, second, secondSocket),
      ]);
      await getRedis().del(keys.presence(roomId));
    }
  });

  it("rejects authentication before loading any document state", async () => {
    const path = `private-${crypto.randomUUID().slice(0, 8)}`;
    const room = await createRoom({ path, passwordHash: null, expiration: "1h" });
    const source = new Y.Doc();
    source.getText("content").insert(0, "DO_NOT_LEAK_SECRET");
    await storeDocument(room!, Y.encodeStateAsUpdate(source));

    const server = new Server({
      ...createRealtimeConfiguration(),
      port: 12403,
      address: "127.0.0.1",
      quiet: true,
      websocketOptions: { maxPayload: 1024 * 1024 },
    });
    await server.listen();
    const received = new Y.Doc();
    const socket = new HocuspocusProviderWebsocket({
      url: "ws://127.0.0.1:12403",
      WebSocketPolyfill: WebSocket,
      autoConnect: false,
    });
    const provider = new HocuspocusProvider({
      name: path,
      document: received,
      token: "malformed-token",
      websocketProvider: socket,
    });
    provider.attach();

    try {
      const rejected = waitForRejection(provider);
      await socket.connect();
      await rejected;
      expect(received.getText("content").toString()).toBe("");
      expect(server.hocuspocus.documents.has(path)).toBe(false);
    } finally {
      provider.destroy();
      socket.destroy();
      await server.destroy();
      await getRedis().del(
        keys.path(path),
        keys.room(room!.id),
        keys.document(room!.id),
        keys.tombstone(path),
      );
    }
  }, 15_000);

  it("converges clients connected to separate Hocuspocus instances", async () => {
    const path = `scale-${crypto.randomUUID().slice(0, 8)}`;
    const room = await createRoom({ path, passwordHash: null, expiration: "1h" });
    expect(room).not.toBeNull();

    const serverOne = new Server({
      ...createRealtimeConfiguration(),
      port: 12401,
      address: "127.0.0.1",
      quiet: true,
      websocketOptions: { maxPayload: 1024 * 1024 },
    });
    const serverTwo = new Server({
      ...createRealtimeConfiguration(),
      port: 12402,
      address: "127.0.0.1",
      quiet: true,
      websocketOptions: { maxPayload: 1024 * 1024 },
    });

    await Promise.all([serverOne.listen(), serverTwo.listen()]);
    const documentOne = new Y.Doc();
    const documentTwo = new Y.Doc();
    const tokenOne = await issueRoomAccessToken({
      roomId: room!.id,
      path,
      participantId: crypto.randomUUID(),
    });
    const tokenTwo = await issueRoomAccessToken({
      roomId: room!.id,
      path,
      participantId: crypto.randomUUID(),
    });

    const socketOne = new HocuspocusProviderWebsocket({
      url: "ws://127.0.0.1:12401",
      WebSocketPolyfill: WebSocket,
      autoConnect: false,
    });
    const socketTwo = new HocuspocusProviderWebsocket({
      url: "ws://127.0.0.1:12402",
      WebSocketPolyfill: WebSocket,
      autoConnect: false,
    });
    const providerOne = new HocuspocusProvider({
      name: path,
      document: documentOne,
      token: tokenOne.token,
      websocketProvider: socketOne,
    });
    const providerTwo = new HocuspocusProvider({
      name: path,
      document: documentTwo,
      token: tokenTwo.token,
      websocketProvider: socketTwo,
    });
    providerOne.attach();
    providerTwo.attach();

    try {
      const synced = Promise.all([waitForSync(providerOne), waitForSync(providerTwo)]);
      await Promise.all([socketOne.connect(), socketTwo.connect()]);
      await synced;
      const received = waitForText(documentTwo.getText("content"), "shared across instances");
      documentOne.getText("content").insert(0, "shared across instances");
      await received;
      expect(documentTwo.getText("content").toString()).toBe("shared across instances");
    } finally {
      providerOne.destroy();
      providerTwo.destroy();
      socketOne.destroy();
      socketTwo.destroy();
      await Promise.all([serverOne.destroy(), serverTwo.destroy()]);
      await getRedis().del(
        keys.path(path),
        keys.room(room!.id),
        keys.document(room!.id),
        keys.tombstone(path),
        keys.presence(room!.id),
      );
    }
  }, 20_000);
});

function waitForSync(provider: HocuspocusProvider) {
  if (provider.synced) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(
          new Error(
            `Realtime sync timed out (status=${provider.configuration.websocketProvider.status}, authenticated=${provider.isAuthenticated}).`,
          ),
        ),
      8_000,
    );
    provider.on("synced", ({ state }: { state: boolean }) => {
      if (!state) return;
      clearTimeout(timeout);
      resolve();
    });
    provider.on("authenticationFailed", ({ reason }: { reason: string }) => {
      clearTimeout(timeout);
      reject(new Error(reason));
    });
  });
}

function waitForText(text: Y.Text, expected: string) {
  if (text.toString() === expected) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Redis convergence timed out.")), 8_000);
    const observer = () => {
      if (text.toString() !== expected) return;
      clearTimeout(timeout);
      text.unobserve(observer);
      resolve();
    };
    text.observe(observer);
  });
}

function waitForRejection(provider: HocuspocusProvider) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Authentication rejection timed out.")), 8_000);
    provider.on("authenticationFailed", () => {
      clearTimeout(timeout);
      resolve();
    });
    provider.on("synced", () => {
      clearTimeout(timeout);
      reject(new Error("Unauthorized provider received a sync frame."));
    });
  });
}
