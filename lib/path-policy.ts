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

export function parseJoinPathInput(value: string) {
  let candidate = value.trim();
  if (!candidate) return null;

  if (/^https?:\/\//i.test(candidate)) {
    try {
      candidate = new URL(candidate).pathname;
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
