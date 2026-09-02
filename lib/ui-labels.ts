import type { SafeRoomMetadata } from "@/lib/types";

export type ConnectionState =
  | "connecting"
  | "synchronizing"
  | "synced"
  | "saving"
  | "reconnecting"
  | "offline"
  | "not-saving";

export function connectionLabel(state: ConnectionState) {
  const labels: Record<ConnectionState, string> = {
    connecting: "Connecting…",
    synchronizing: "Synchronizing…",
    synced: "Synced",
    saving: "Saving…",
    reconnecting: "Reconnecting…",
    offline: "Offline",
    "not-saving": "Not saving",
  };

  return labels[state];
}

/** Whether the server has told us it can still persist this room. */
export type PersistenceState = "ok" | "document-too-large" | "storage-failed";

export interface ConnectionSignals {
  online: boolean;
  connected: boolean;
  everConnected: boolean;
  synced: boolean;
  unsyncedCount: number;
  persistence: PersistenceState;
}

/**
 * Reduces every realtime signal to the single thing the status pill claims.
 *
 * These signals used to be written independently by three provider callbacks
 * that fire in no guaranteed order, so whichever landed last won: a fully
 * synchronized room could sit on "Synchronizing…", a freshly opened one
 * announced "Saving…" before anyone had typed, and going offline with pending
 * edits still claimed "Saving…" — the exact claim this project's labels are
 * written to avoid. Deriving the label from all of them removes the race, and
 * makes the precedence explicit and testable.
 *
 * Order matters: a room the server cannot persist must never read as saved,
 * even while the participants are perfectly in sync with each other.
 */
export function deriveConnectionState(signals: ConnectionSignals): ConnectionState {
  if (signals.persistence !== "ok") return "not-saving";
  if (!signals.online) return "offline";
  if (!signals.connected) return signals.everConnected ? "reconnecting" : "connecting";
  if (!signals.synced) return "synchronizing";
  return signals.unsyncedCount > 0 ? "saving" : "synced";
}

/** The banner shown when the server has told us it cannot store the room. */
export function persistenceNotice(state: PersistenceState) {
  if (state === "document-too-large") {
    return "This room has reached its 1 MB content limit. Edits are still shared with everyone here, but they are no longer being saved — copy anything you need to keep.";
  }
  if (state === "storage-failed") {
    return "PrivCircle cannot save this room right now. Edits are still shared live and saving will resume automatically — keep this tab open, and copy anything you cannot lose.";
  }
  return "";
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

/**
 * How long a rate-limited caller must wait, in words.
 *
 * The server already knows the remaining window, so the UI states it instead of
 * asking the user to guess whether "try again later" means seconds or minutes.
 */
export function retryAfterLabel(seconds: number) {
  const total = Math.max(1, Math.ceil(seconds));
  if (total <= 45) return "a few seconds";
  const minutes = Math.round(total / 60);
  if (minutes <= 1) return "about a minute";
  if (minutes < 60) return `about ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours <= 1 ? "about an hour" : `about ${hours} hours`;
}
