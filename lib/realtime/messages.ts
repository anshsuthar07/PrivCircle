/**
 * The stateless side-channel between the realtime server and the browser.
 *
 * Yjs guarantees that participants converge with each other; it says nothing
 * about whether the server managed to *persist* what they converged on. When a
 * store fails, the document keeps syncing perfectly between two live tabs and
 * then reverts on the next reload, so the failure has to travel out of band.
 * These messages are that channel, and they are the only thing sent over it
 * besides the client's heartbeat.
 */

export const HEARTBEAT = "heartbeat";

export type PersistenceCode = "ok" | "document-too-large" | "storage-failed";

export interface PersistenceMessage {
  type: "persistence";
  code: PersistenceCode;
}

export function encodePersistence(code: PersistenceCode) {
  return JSON.stringify({ type: "persistence", code } satisfies PersistenceMessage);
}

/** Parses a server message, returning null for anything unrecognized. */
export function decodePersistence(payload: string): PersistenceMessage | null {
  try {
    const parsed = JSON.parse(payload) as Partial<PersistenceMessage>;
    if (parsed?.type !== "persistence") return null;
    return parsed.code === "ok" ||
      parsed.code === "document-too-large" ||
      parsed.code === "storage-failed"
      ? { type: "persistence", code: parsed.code }
      : null;
  } catch {
    return null;
  }
}
