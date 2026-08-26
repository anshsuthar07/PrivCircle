import { randomInt } from "node:crypto";
import { z } from "zod";

export const RESERVED_PATHS = new Set([
  "api",
  "ws",
  "login",
  "admin",
  "settings",
  "signin",
  "signout",
  "_next",
]);

const pathExpression = /^[a-zA-Z0-9_-]+$/;

export const createRoomSchema = z
  .object({
    path: z.string().trim().min(3).max(64).regex(pathExpression).optional(),
    passwordProtected: z.boolean().default(false),
    password: z.string().min(8).max(128).optional(),
    expiration: z.enum(["1h", "24h", "7d", "lifetime"]).default("24h"),
  })
  .superRefine((value, context) => {
    if (value.passwordProtected && !value.password) {
      context.addIssue({
        code: "custom",
        path: ["password"],
        message: "Password must be between 8 and 128 characters.",
      });
    }
  });

export const authRoomSchema = z.object({
  password: z.string().max(128),
});

export function normalizeRoomPath(value: string) {
  return value.trim().toLowerCase();
}

export function isValidRoomPath(value: string) {
  const normalized = normalizeRoomPath(value);
  return (
    normalized.length >= 3 &&
    normalized.length <= 64 &&
    pathExpression.test(normalized) &&
    !RESERVED_PATHS.has(normalized)
  );
}

export function generateRoomPath(length = 12) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join("");
}
