import { describe, expect, it } from "vitest";
import {
  createRoomSchema,
  generateRoomPath,
  isValidRoomPath,
  normalizeRoomPath,
} from "@/lib/validation";
import { getRoomPathIssue, parseJoinPathInput } from "@/lib/path-policy";
import { EXPIRATION_SECONDS } from "@/lib/types";

describe("room input validation", () => {
  it("normalizes canonical paths", () => {
    expect(normalizeRoomPath("  Team_Dev-1 ")).toBe("team_dev-1");
  });

  it.each(["../secret", "a/b", "a?b", "a#b", "api", "admin", "ab"])(
    "rejects unsafe or reserved path %s",
    (path) => expect(isValidRoomPath(path)).toBe(false),
  );

  it.each(["abc", "team-dev", "private_code", "ABC123"])(
    "accepts valid path %s",
    (path) => expect(isValidRoomPath(path)).toBe(true),
  );

  it("accepts path-only and same-origin room links for joining", () => {
    const origin = "https://privcircle.vercel.app";
    expect(parseJoinPathInput(" Team_Dev-1 ", origin)).toBe("team_dev-1");
    expect(parseJoinPathInput("/team-dev/", origin)).toBe("team-dev");
    expect(parseJoinPathInput("https://privcircle.vercel.app/Secret-Room", origin)).toBe(
      "secret-room",
    );
    expect(parseJoinPathInput("https://privcircle.vercel.app/api", origin)).toBeNull();
    expect(parseJoinPathInput("https://example.com/team-dev", origin)).toBeNull();
    expect(parseJoinPathInput("not a url", origin)).toBeNull();
    expect(parseJoinPathInput("../secret", origin)).toBeNull();
  });

  it("reports precise custom-path policy failures", () => {
    expect(getRoomPathIssue("ab")).toBe("too-short");
    expect(getRoomPathIssue("a".repeat(65))).toBe("too-long");
    expect(getRoomPathIssue("team room")).toBe("invalid-characters");
    expect(getRoomPathIssue("security")).toBe("reserved");
    expect(getRoomPathIssue("team-room")).toBeNull();
  });

  it("requires strong-enough optional passwords", () => {
    for (const password of ["short", "longenough", "long-enough", "12345678!"]) {
      expect(
        createRoomSchema.safeParse({
          path: "room-one",
          passwordProtected: true,
          password,
          expiration: "24h",
        }).success,
      ).toBe(false);
    }
    expect(
      createRoomSchema.safeParse({
        path: "room-one",
        passwordProtected: true,
        password: "long-enough1",
        expiration: "24h",
      }).success,
    ).toBe(true);
  });

  it("generates high-entropy shaped identifiers", () => {
    const values = new Set(Array.from({ length: 100 }, () => generateRoomPath()));
    expect(values.size).toBe(100);
    for (const value of values) expect(value).toMatch(/^[a-z0-9]{12}$/);
  });

  it("maps inactivity policies exactly", () => {
    expect(EXPIRATION_SECONDS).toEqual({
      "1h": 3600,
      "24h": 86400,
      "7d": 604800,
      lifetime: null,
    });
  });
});
