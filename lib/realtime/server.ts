import { createHash } from "node:crypto";
import { Database } from "@hocuspocus/extension-database";
import { Redis as RedisExtension } from "@hocuspocus/extension-redis";
import {
  Hocuspocus,
  type Configuration,
  type WebSocketLike,
} from "@hocuspocus/server";
import { verifyRoomAccessToken } from "@/lib/auth/tokens";
import { getAppOrigin, isProduction } from "@/lib/config";
import { getRedis } from "@/lib/redis";
import type { RealtimeContext } from "@/lib/types";
import {
  getRoom,
  loadDocument,
  storeDocument,
  touchRoom,
} from "@/lib/storage/rooms";
import {
  claimParticipant,
  refreshParticipant,
  releaseParticipant,
} from "./presence";

const colors = ["#72e8aa", "#72b9e8", "#d79bea", "#f0be72"];

class RealtimeAuthorizationError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "RealtimeAuthorizationError";
  }
}

function deny(reason: string): never {
  throw new RealtimeAuthorizationError(reason);
}

function participantAppearance(participantId: string) {
  const digest = createHash("sha256").update(participantId).digest();
  return {
    displayName: `Guest ${participantId.slice(0, 4).toUpperCase()}`,
    color: colors[digest[0] % colors.length],
  };
}

export function createRealtimeConfiguration(): Partial<
  Configuration<RealtimeContext>
> {
  return {
    timeout: 60_000,
    debounce: 2_000,
    maxDebounce: 10_000,
    unloadImmediately: true,
    maxUnauthenticatedQueueSize: 64 * 1024,
    maxUnauthenticatedQueueMessages: 20,
    maxPendingDocuments: 1,
    extensions: [
      new RedisExtension({
        redis: getRedis(),
        prefix: "privcircle:hocuspocus",
        awaitInitialSyncTimeout: 3_000,
      }),
      new Database({
        async fetch({ documentName }) {
          const room = await getRoom(documentName);
          if (!room) return null;
          return loadDocument(room);
        },
        async store({ documentName, state }) {
          const room = await getRoom(documentName);
          if (!room) throw new Error("Room is unavailable.");
          await storeDocument(room, state);
        },
      }),
    ],
    async onAuthenticate({
      documentName,
      token,
      socketId,
      requestHeaders,
      request,
    }) {
      const origin = requestHeaders.get("origin");
      const requestUrl = new URL(request.url);
      const requestProtocol = requestUrl.protocol === "wss:" ? "https:" :
        requestUrl.protocol === "ws:" ? "http:" : requestUrl.protocol;
      const requestOrigin = `${requestProtocol}//${requestUrl.host}`;
      if (
        (!origin && isProduction) ||
        (origin && origin !== getAppOrigin() && origin !== requestOrigin)
      ) {
        deny("ACCESS_DENIED");
      }
      const expectedPath = requestHeaders.get("x-privcircle-room-path");
      if (expectedPath && expectedPath !== documentName) {
        deny("ACCESS_DENIED");
      }

      let claims;
      try {
        claims = await verifyRoomAccessToken(token);
      } catch {
        deny("ACCESS_DENIED");
      }

      if (claims.path !== documentName) {
        deny("ACCESS_DENIED");
      }

      const room = await getRoom(documentName);
      if (!room || room.id !== claims.roomId) {
        deny("ROOM_UNAVAILABLE");
      }

      if (!(await claimParticipant(room.id, claims.participantId, socketId))) {
        deny("ROOM_FULL");
      }

      const appearance = participantAppearance(claims.participantId);
      await touchRoom(room);
      return {
        roomId: room.id,
        path: room.path,
        participantId: claims.participantId,
        socketId,
        ...appearance,
      } satisfies RealtimeContext;
    },
    async beforeHandleAwareness({ context, states }) {
      if (!context) return;
      for (const state of states.values()) {
        state.user = {
          id: context.participantId,
          name: context.displayName,
          color: context.color,
          colorLight: `${context.color}33`,
        };
      }
    },
    async onStateless({ connection, payload, documentName }) {
      if (payload !== "heartbeat") return;
      const context = connection.context;
      if (!context) return;
      await Promise.all([
        refreshParticipant(
          context.roomId,
          context.participantId,
          context.socketId,
        ),
        getRoom(documentName).then((room) => (room ? touchRoom(room) : undefined)),
      ]);
    },
    async onChange({ documentName }) {
      const room = await getRoom(documentName);
      if (room) await touchRoom(room);
    },
    async onDisconnect({ context, documentName }) {
      if (context) {
        await releaseParticipant(
          context.roomId,
          context.participantId,
          context.socketId,
        );
      }
      const room = await getRoom(documentName);
      if (room) await touchRoom(room);
    },
  };
}

declare global {
  var __privCircleHocuspocus: Hocuspocus<RealtimeContext> | undefined;
}

export function getHocuspocus() {
  if (!globalThis.__privCircleHocuspocus) {
    globalThis.__privCircleHocuspocus = new Hocuspocus<RealtimeContext>(
      createRealtimeConfiguration(),
    );
  }
  return globalThis.__privCircleHocuspocus;
}

export function attachHocuspocusSocket(
  socket: WebSocketLike,
  request: Request,
) {
  return getHocuspocus().handleConnection(socket, request);
}
