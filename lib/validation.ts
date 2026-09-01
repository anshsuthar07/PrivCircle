import { randomInt } from "node:crypto";
import { z } from "zod";
import { MAX_DOCUMENT_BYTES } from "./documents/config";
import {
  isStrongPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "./password-policy";
export { isValidRoomPath, normalizeRoomPath, RESERVED_PATHS } from "./path-policy";

const pathExpression = /^[a-zA-Z0-9_-]+$/;

export const createRoomSchema = z
  .object({
    path: z.string().trim().min(3).max(64).regex(pathExpression).optional(),
    passwordProtected: z.boolean().default(false),
    password: z.string().max(PASSWORD_MAX_LENGTH).optional(),
    expiration: z.enum(["1h", "24h", "7d", "lifetime"]).default("24h"),
  })
  .superRefine((value, context) => {
    if (
      value.passwordProtected &&
      (!value.password || !isStrongPassword(value.password))
    ) {
      context.addIssue({
        code: "custom",
        path: ["password"],
        message: `Use ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters with a letter, number, and special character.`,
      });
    }
  });

export const authRoomSchema = z.object({
  password: z.string().max(128),
});

/**
 * Upload initiation input.
 *
 * The declared size is bounded here so an obviously oversized request is
 * refused before any storage credential is minted. It is a first gate, not the
 * enforcement: the upload token carries the same ceiling, and the finalize step
 * re-reads the true size from the storage provider.
 */
export const createDocumentSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  size: z.number().int().nonnegative().max(MAX_DOCUMENT_BYTES),
  contentType: z.string().max(255).optional(),
});

export function generateRoomPath(length = 12) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join("");
}
