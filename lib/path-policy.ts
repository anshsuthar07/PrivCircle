export const RESERVED_PATHS = new Set([
  "api",
  "ws",
  "login",
  "admin",
  "settings",
  "security",
  "signin",
  "signout",
  "_next",
]);

const pathExpression = /^[a-zA-Z0-9_-]+$/;

export type RoomPathIssue =
  | "too-short"
  | "too-long"
  | "invalid-characters"
  | "reserved"
  | null;

export function normalizeRoomPath(value: string) {
  return value.trim().toLowerCase();
}

export function isValidRoomPath(value: string) {
  return getRoomPathIssue(value) === null;
}

export function getRoomPathIssue(value: string): RoomPathIssue {
  const normalized = normalizeRoomPath(value);
  if (normalized.length < 3) return "too-short";
  if (normalized.length > 64) return "too-long";
  if (!pathExpression.test(normalized)) return "invalid-characters";
  if (RESERVED_PATHS.has(normalized)) return "reserved";
  return null;
}

export function parseJoinPathInput(value: string, expectedOrigin?: string) {
  let candidate = value.trim();
  if (!candidate) return null;

  if (/^https?:\/\//i.test(candidate)) {
    try {
      const url = new URL(candidate);
      if (expectedOrigin && url.origin !== expectedOrigin) return null;
      candidate = url.pathname;
    } catch {
      return null;
    }
  } else {
    [candidate] = candidate.split(/[?#]/, 1);
  }

  candidate = candidate.replace(/^\/+|\/+$/g, "");
  const normalized = normalizeRoomPath(candidate);
  return isValidRoomPath(normalized) ? normalized : null;
}
