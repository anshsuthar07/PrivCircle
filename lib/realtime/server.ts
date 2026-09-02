import { createHash } from "node:crypto";
import { Database } from "@hocuspocus/extension-database";
import { Redis as RedisExtension } from "@hocuspocus/extension-redis";
import {
  Hocuspocus,
  type Configuration,
  type Document,
  type WebSocketLike,
} from "@hocuspocus/server";
import { verifyRoomAccessToken } from "@/lib/auth/tokens";
import { getAppOrigin, isProduction } from "@/lib/config";
import { reportError } from "@/lib/observability";
import { getRedis } from "@/lib/redis";
import type { RealtimeContext } from "@/lib/types";
import {
  DocumentTooLargeError,
  getRoom,
  loadDocument,
  storeDocument,
  touchRoom,
} from "@/lib/storage/rooms";
import { encodePersistence, HEARTBEAT, type PersistenceCode } from "./messages";
import {
  claimParticipant,
  refreshParticipant,
  releaseParticipant,
} from "./presence";

/**
 * Cursor colours, one per seat's worth of distinctness.
 *
 * Four was enough when a room was a pair. In a group, colour is the only thing
 * telling one remote cursor from another, so the palette is sized to the room
 * and every entry is picked to stay legible against the dark editor surface.
 */
const colors = [
  "#72e8aa",
  "#72b9e8",
  "#d79bea",
  "#f0be72",
  "#f0908f",
  "#8ad4c4",
  "#a5b4fc",
  "#f5a3c7",
  "#c3e88d",
  "#7fd1e8",
  "#e8c37f",
  "#b79bea",
];

/**
 * How often room activity is written back to storage.
 *
 * Retention is a sliding window measured in hours, so refreshing it on every
 * single document change bought nothing and cost a room lookup plus a
 * four-command write per keystroke burst — by far the largest source of Redis
 * traffic in the application. Refreshing at most this often keeps the same
 * behaviour with a margin of three orders of magnitude against the shortest
 * one-hour policy, and a disconnect always flushes regardless.
 */
const TOUCH_INTERVAL_MS = 30_000;

const lastTouchedAt = new Map<string, number>();

/** Bounded so a long-lived warm instance cannot accumulate room names. */
function rememberTouch(documentName: string, at: number) {
  if (lastTouchedAt.size > 500) lastTouchedAt.clear();
  lastTouchedAt.set(documentName, at);
}

/**
 * Slides a room's retention window, at most once per interval.
 *
 * The room is still resolved through `getRoom()` rather than cached on the
 * connection: a room that has genuinely expired must stay expired, and a cached
 * record would let an open socket recreate its keys.
 */
async function touchRoomForConnection(documentName: string, force = false) {
  const now = Date.now();
  if (!force && now - (lastTouchedAt.get(documentName) ?? 0) < TOUCH_INTERVAL_MS) {
    return;
  }
  rememberTouch(documentName, now);
  try {
    const room = await getRoom(documentName);
    if (room) await touchRoom(room);
  } catch (error) {
    reportError("realtime.touch", error);
  }
}

/**
 * The last persistence state announced for a document.
 *
 * Only transitions are broadcast, so a document that cannot be stored says so
 * once rather than on every debounce, and recovery clears the warning without
 * requiring a reload.
 */
const persistenceState = new Map<string, PersistenceCode>();

function announcePersistence(
  document: Document,
  documentName: string,
  code: PersistenceCode,
) {
  if (persistenceState.get(documentName) === code) return;
  if (persistenceState.size > 500) persistenceState.clear();
  persistenceState.set(documentName, code);
  try {
    document.broadcastStateless(encodePersistence(code));
  } catch (error) {
    reportError("realtime.announce", error);
  }
}

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
          try {
            const room = await getRoom(documentName);
            if (!room) return null;
            return await loadDocument(room);
          } catch (error) {
            reportError("realtime.fetch", error);
            throw error;
          }
        },
        async store({ documentName, state, document }) {
          try {
            const room = await getRoom(documentName);
            if (!room) throw new Error("Room is unavailable.");
            await storeDocument(room, state);
            announcePersistence(document, documentName, "ok");
          } catch (error) {
            if (error instanceof DocumentTooLargeError) {
              // Not retryable and not the caller's to recover from, so it is
              // reported once and pushed to the people editing instead of being
              // rethrown into a retry loop that can never succeed.
              reportError("realtime.store.too-large", error);
              announcePersistence(document, documentName, "document-too-large");
              return;
            }
            reportError("realtime.store", error);
            announcePersistence(document, documentName, "storage-failed");
            throw error;
          }
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
      rememberTouch(documentName, Date.now());
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
      if (payload !== HEARTBEAT) return;
      const context = connection.context;
      if (!context) return;
      await Promise.all([
        refreshParticipant(
          context.roomId,
          context.participantId,
          context.socketId,
        ),
        touchRoomForConnection(documentName),
      ]);
    },
    async onChange({ documentName }) {
      await touchRoomForConnection(documentName);
    },
    async onDisconnect({ context, documentName }) {
      if (context) {
        await releaseParticipant(
          context.roomId,
          context.participantId,
          context.socketId,
        );
      }
      // Always flushed: this is the moment the retention countdown starts, so
      // it must reflect the real last activity rather than a throttled stamp.
      await touchRoomForConnection(documentName, true);
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
