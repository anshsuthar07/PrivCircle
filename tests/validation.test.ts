import { describe, expect, it } from "vitest";
import {
  createRoomSchema,
  generateRoomPath,
  isValidRoomPath,
  normalizeRoomPath,
} from "@/lib/validation";
import { parseJoinPathInput } from "@/lib/path-policy";
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

  it("accepts room paths and shared URLs for joining", () => {
    expect(parseJoinPathInput(" Team_Dev-1 ")).toBe("team_dev-1");
    expect(parseJoinPathInput("/team-dev/")).toBe("team-dev");
    expect(parseJoinPathInput("https://privcircle.vercel.app/Secret-Room")).toBe(
      "secret-room",
    );
    expect(parseJoinPathInput("https://privcircle.vercel.app/api")).toBeNull();
    expect(parseJoinPathInput("../secret")).toBeNull();
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
