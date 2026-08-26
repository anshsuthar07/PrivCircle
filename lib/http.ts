import { NextResponse } from "next/server";
import { ConfigurationError } from "./config";
import { RateLimitError } from "./security/rate-limit";

export function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export function serviceError(error: unknown) {
  if (error instanceof RateLimitError) {
    return noStoreJson(
      { code: "RATE_LIMITED", message: "Too many requests. Please wait and try again." },
      {
        status: 429,
        headers: { "Retry-After": String(error.retryAfter) },
      },
    );
  }

  if (error instanceof ConfigurationError) {
    return noStoreJson(
      { code: "SERVICE_UNAVAILABLE", message: "Room storage is not configured." },
      { status: 503 },
    );
  }

  return noStoreJson(
    { code: "SERVICE_UNAVAILABLE", message: "The room service is unavailable." },
    { status: 503 },
  );
}

export async function readSmallJson(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new TypeError("JSON_REQUIRED");
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 2_048) throw new RangeError("BODY_TOO_LARGE");
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 2_048) {
    throw new RangeError("BODY_TOO_LARGE");
  }
  return JSON.parse(body) as unknown;
}
