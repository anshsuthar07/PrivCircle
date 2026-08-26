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
      socket.on("message", (data) => connection.handleMessage(toUint8Array(data)));
      socket.on("close", (code, reason) =>
        connection.handleClose({ code, reason: reason.toString() }),
      );
      socket.on("error", () => connection.handleClose({ code: 1011, reason: "socket-error" }));
    },
    { maxPayload: 1024 * 1024 },
  );
}
