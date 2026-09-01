import type { SafeRoomMetadata } from "@/lib/types";

export type ConnectionState =
  | "connecting"
  | "synchronizing"
  | "synced"
  | "saving"
  | "reconnecting"
  | "offline";

export function connectionLabel(state: ConnectionState) {
  const labels: Record<ConnectionState, string> = {
    connecting: "Connecting…",
    synchronizing: "Synchronizing…",
    synced: "Synced",
    saving: "Saving…",
    reconnecting: "Reconnecting…",
    offline: "Offline",
  };

  return labels[state];
}

export function expirationLabel(metadata: Pick<SafeRoomMetadata, "expiration">) {
  const labels: Record<SafeRoomMetadata["expiration"], string> = {
    "1h": "Deletes 1 hour after everyone leaves",
    "24h": "Deletes 24 hours after everyone leaves",
    "7d": "Deletes 7 days after everyone leaves",
    lifetime: "No automatic expiry",
  };

  return labels[metadata.expiration];
}

const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

/** Compact file size for list rows, e.g. `4.8 MB`. */
export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 || unit === 0 ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded} ${BYTE_UNITS[unit]}`;
}

/** Upload age, e.g. `just now`, `12 min ago`, `3 hr ago`. */
export function uploadedLabel(createdAt: string, now: number = Date.now()) {
  const elapsed = now - new Date(createdAt).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return "just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/**
 * Remaining lifetime for a temporary document.
 *
 * This is a label, not a control. The server re-checks expiry on every listing
 * and download, so a stale tab can show the wrong number but can never turn it
 * into access.
 */
export function expiryLabel(expiresAt: string, now: number = Date.now()) {
  const remaining = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return "Expired";
  const minutes = Math.floor(remaining / 60_000);
  if (minutes < 60) return minutes < 10 ? "Expires soon" : `Expires in ${minutes}m`;
  return `Expires in ${Math.floor(minutes / 60)}h`;
}
