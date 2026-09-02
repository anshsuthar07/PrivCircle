import { describe, expect, it } from "vitest";
import {
  connectionLabel,
  deriveConnectionState,
  persistenceNotice,
  retryAfterLabel,
  type ConnectionSignals,
} from "@/lib/ui-labels";

/**
 * The status pill used to be written by three provider callbacks that fire in
 * no guaranteed order, so whichever landed last won. These cases pin the
 * precedence that replaced them — in particular that nothing claims work is
 * saved when it is not.
 */
const connected: ConnectionSignals = {
  online: true,
  connected: true,
  everConnected: true,
  synced: true,
  unsyncedCount: 0,
  persistence: "ok",
};

describe("derived connection state", () => {
  it("reports a settled room as synced", () => {
    expect(deriveConnectionState(connected)).toBe("synced");
  });

  it("distinguishes a first connection from a reconnection", () => {
    expect(
      deriveConnectionState({
        ...connected,
        connected: false,
        everConnected: false,
        synced: false,
      }),
    ).toBe("connecting");
    expect(
      deriveConnectionState({ ...connected, connected: false, synced: false }),
    ).toBe("reconnecting");
  });

  it("stays on synchronizing only until the first sync completes", () => {
    expect(deriveConnectionState({ ...connected, synced: false })).toBe(
      "synchronizing",
    );
  });

  it("does not fall back to synchronizing after a duplicate connected event", () => {
    // The provider emits `connected` several times per session. Re-applying it
    // must not undo a sync that has already happened.
    const afterDuplicate = deriveConnectionState({ ...connected, connected: true });
    expect(afterDuplicate).toBe("synced");
  });

  it("never claims to be saving while offline", () => {
    const state = deriveConnectionState({
      ...connected,
      online: false,
      unsyncedCount: 4,
    });
    expect(state).toBe("offline");
    expect(connectionLabel(state)).toBe("Offline");
  });

  it("reports pending local edits as saving only while connected", () => {
    expect(deriveConnectionState({ ...connected, unsyncedCount: 2 })).toBe("saving");
  });

  it("refuses to read as synced when the server cannot persist the room", () => {
    for (const persistence of ["document-too-large", "storage-failed"] as const) {
      const state = deriveConnectionState({ ...connected, persistence });
      expect(state).toBe("not-saving");
      expect(connectionLabel(state)).toBe("Not saving");
    }
  });
});

describe("persistence notices", () => {
  it("says nothing while storage is healthy", () => {
    expect(persistenceNotice("ok")).toBe("");
  });

  it("tells the reader their work is not being kept, and what to do", () => {
    for (const code of ["document-too-large", "storage-failed"] as const) {
      const notice = persistenceNotice(code).toLowerCase();
      // States that saving has stopped...
      expect(notice).toMatch(/no longer being saved|cannot save/);
      // ...and offers the only recovery available to the reader.
      expect(notice).toContain("copy");
      // ...without ever implying the work is already safe.
      expect(notice).not.toMatch(/saved successfully|is saved|synced/);
    }
  });
});

describe("retry-after wording", () => {
  it("states the wait instead of leaving it to be guessed", () => {
    expect(retryAfterLabel(5)).toBe("a few seconds");
    expect(retryAfterLabel(60)).toBe("about a minute");
    expect(retryAfterLabel(577)).toBe("about 10 minutes");
    expect(retryAfterLabel(3_600)).toBe("about an hour");
    expect(retryAfterLabel(7_200)).toBe("about 2 hours");
  });

  it("never reports a non-positive wait", () => {
    expect(retryAfterLabel(0)).toBe("a few seconds");
    expect(retryAfterLabel(-10)).toBe("a few seconds");
  });
});
