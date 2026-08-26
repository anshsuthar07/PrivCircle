import { describe, expect, it } from "vitest";
import { connectionLabel, expirationLabel } from "@/lib/ui-labels";

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
