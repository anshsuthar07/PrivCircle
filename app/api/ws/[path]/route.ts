import { experimental_upgradeWebSocket } from "@vercel/functions";
import type { WebSocketLike } from "@hocuspocus/server";
import type { RawData, WebSocket } from "ws";
import { NextRequest, NextResponse } from "next/server";
import { attachHocuspocusSocket } from "@/lib/realtime/server";
import {
  enforceRateLimit,
  RateLimitError,
  requestSubject,
} from "@/lib/security/rate-limit";
import { isTrustedOrigin } from "@/lib/security/origin";
import { isValidRoomPath, normalizeRoomPath } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * How long a freshly upgraded socket may stay silent.
 *
 * A real client sends its authentication frame as soon as the socket opens.
 * Without a deadline, a socket that never speaks was held for the full function
 * duration, so opening them in a loop reserved concurrency for five minutes a
 * time at almost no cost to the caller. Closing a silent socket makes that
 * pointless while leaving a slow but genuine client far more time than it needs.
 */
const FIRST_MESSAGE_TIMEOUT_MS = 15_000;
const SILENT_SOCKET_CLOSE_CODE = 4408;

function toUint8Array(data: RawData) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string }> },
) {
  const path = normalizeRoomPath((await context.params).path);
  if (!isValidRoomPath(path)) {
    return NextResponse.json({ code: "ROOM_UNAVAILABLE" }, { status: 404 });
  }
  if (!isTrustedOrigin(request)) {
    return NextResponse.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  }

  try {
    await enforceRateLimit({
      scope: "ws",
      subject: requestSubject(request),
      limit: 20,
      windowSeconds: 60,
    });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        { code: "RATE_LIMITED" },
        { status: 429, headers: { "Retry-After": String(error.retryAfter) } },
      );
    }
    return NextResponse.json({ code: "SERVICE_UNAVAILABLE" }, { status: 503 });
  }

  return experimental_upgradeWebSocket(
    (socket: WebSocket) => {
      const headers = new Headers(request.headers);
      headers.set("x-privcircle-room-path", path);
      const realtimeRequest = new Request(request.url, { headers });
      const connection = attachHocuspocusSocket(
        socket as unknown as WebSocketLike,
        realtimeRequest,
      );

      const silenceTimer = setTimeout(() => {
        try {
          socket.close(SILENT_SOCKET_CLOSE_CODE, "AUTH_TIMEOUT");
        } catch {
          // The socket is already gone; nothing left to release.
        }
      }, FIRST_MESSAGE_TIMEOUT_MS);
      // `unref` where available so the deadline never keeps a process alive.
      silenceTimer.unref?.();

      socket.on("message", (data) => {
        clearTimeout(silenceTimer);
        connection.handleMessage(toUint8Array(data));
      });
      socket.on("close", (code, reason) => {
        clearTimeout(silenceTimer);
        connection.handleClose({ code, reason: reason.toString() });
      });
      socket.on("error", () => {
        clearTimeout(silenceTimer);
        connection.handleClose({ code: 1011, reason: "socket-error" });
      });
    },
    { maxPayload: 1024 * 1024 },
  );
}
