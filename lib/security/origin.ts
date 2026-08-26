import type { NextRequest } from "next/server";
import { getAppOrigin } from "@/lib/config";

export function isTrustedOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  const requestOrigin = new URL(request.url).origin;
  return origin === requestOrigin || origin === getAppOrigin();
}
