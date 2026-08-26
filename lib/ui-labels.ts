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
