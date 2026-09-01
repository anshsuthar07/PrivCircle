import { describe, expect, it } from "vitest";
import {
  connectionLabel,
  expirationLabel,
  expiryLabel,
  formatBytes,
  uploadedLabel,
} from "@/lib/ui-labels";

describe("UI behavior labels", () => {
  it("maps connection states without claiming unsynchronized work is saved", () => {
    expect(connectionLabel("connecting")).toBe("Connecting…");
    expect(connectionLabel("synchronizing")).toBe("Synchronizing…");
    expect(connectionLabel("synced")).toBe("Synced");
    expect(connectionLabel("saving")).toBe("Saving…");
    expect(connectionLabel("reconnecting")).toBe("Reconnecting…");
    expect(connectionLabel("offline")).toBe("Offline");
  });

  it("describes retention by behavior", () => {
    expect(expirationLabel({ expiration: "1h" })).toBe(
      "Deletes 1 hour after everyone leaves",
    );
    expect(expirationLabel({ expiration: "24h" })).toBe(
      "Deletes 24 hours after everyone leaves",
    );
    expect(expirationLabel({ expiration: "7d" })).toBe(
      "Deletes 7 days after everyone leaves",
    );
    expect(expirationLabel({ expiration: "lifetime" })).toBe(
      "No automatic expiry",
    );
  });
});

describe("temporary document labels", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1024, "1 KB"],
    [5_033_165, "4.8 MB"],
    [300 * 1024 * 1024, "300 MB"],
    [1024 * 1024 * 1024, "1 GB"],
  ])("formats %i bytes as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  it("describes how long ago a file was shared", () => {
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);
    const at = (minutesAgo: number) =>
      new Date(now - minutesAgo * 60_000).toISOString();

    expect(uploadedLabel(at(0), now)).toBe("just now");
    expect(uploadedLabel(at(12), now)).toBe("12 min ago");
    expect(uploadedLabel(at(90), now)).toBe("1 hr ago");
    expect(uploadedLabel(at(60 * 30), now)).toBe("1 d ago");
  });

  it("counts down to expiry and never implies access after it", () => {
    const now = Date.UTC(2026, 0, 2, 12, 0, 0);
    const inMinutes = (minutes: number) =>
      new Date(now + minutes * 60_000).toISOString();

    expect(expiryLabel(inMinutes(60 * 23), now)).toBe("Expires in 23h");
    expect(expiryLabel(inMinutes(45), now)).toBe("Expires in 45m");
    expect(expiryLabel(inMinutes(4), now)).toBe("Expires soon");
    expect(expiryLabel(inMinutes(0), now)).toBe("Expired");
    expect(expiryLabel(inMinutes(-120), now)).toBe("Expired");
  });
});
