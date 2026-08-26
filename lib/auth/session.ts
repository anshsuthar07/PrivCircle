import { createHash, randomBytes } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { getRequiredEnv, isProduction } from "@/lib/config";

const productionCookieName = "__Host-pc_session";
const developmentCookieName = "pc_session";
const maxAge = 7 * 24 * 60 * 60;

export function getSessionCookieName() {
  return isProduction ? productionCookieName : developmentCookieName;
}

export function getOrCreateSessionToken(request: NextRequest) {
  return (
    request.cookies.get(getSessionCookieName())?.value ||
    randomBytes(32).toString("base64url")
  );
}

export function attachSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(getSessionCookieName(), token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    path: "/",
    maxAge,
  });
}

export function hashSessionToken(token: string) {
  const pepper = getRequiredEnv("SESSION_PEPPER");
  if (pepper.length < 32) {
    throw new Error("SESSION_PEPPER must be at least 32 characters.");
  }
  return createHash("sha256")
    .update(token)
    .update(pepper)
    .digest("hex");
}
