import { afterAll, describe, expect, it } from "vitest";
import { getRedis } from "@/lib/redis";
import { keys } from "@/lib/storage/keys";
import {
  enforceRateLimit,
  peekRateLimit,
  RateLimitError,
} from "@/lib/security/rate-limit";

const subjects: Array<[string, string]> = [];

function subject(scope: string) {
  const value = crypto.randomUUID().slice(0, 12);
  subjects.push([scope, value]);
  return value;
}

afterAll(async () => {
  for (const [scope, value] of subjects) {
    await getRedis().del(keys.rateLimit(scope, value));
  }
  getRedis().disconnect();
});

describe.sequential("rate limiting", () => {
  it("admits up to the limit and refuses beyond it", async () => {
    const value = subject("test-enforce");
    const limit = { scope: "test-enforce", subject: value, limit: 3, windowSeconds: 60 };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(enforceRateLimit(limit)).resolves.toBeUndefined();
    }
    await expect(enforceRateLimit(limit)).rejects.toBeInstanceOf(RateLimitError);
  });

  it("reports how long the caller must wait", async () => {
    const value = subject("test-retry");
    const limit = { scope: "test-retry", subject: value, limit: 1, windowSeconds: 120 };
    await enforceRateLimit(limit);
    await expect(enforceRateLimit(limit)).rejects.toMatchObject({
      retryAfter: expect.any(Number),
    });
    const error = await enforceRateLimit(limit).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(RateLimitError);
    const refusal = error as RateLimitError;
    expect(refusal.retryAfter).toBeGreaterThan(0);
    // The wait is stated rather than left to the caller to guess.
    expect(refusal.userMessage).toMatch(/try again in about \d+ minutes/i);
  });

  /**
   * The product budget is checked before work begins but only charged once the
   * work succeeds. Charging it up front meant a mistyped room name or a name
   * someone else had already taken consumed one of the ten rooms an hour.
   */
  it("peeking does not consume the budget", async () => {
    const value = subject("test-peek");
    const scope = "test-peek";
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(peekRateLimit({ scope, subject: value, limit: 2 })).resolves.toBeUndefined();
    }
    // Ten peeks later the budget is still completely untouched.
    await expect(
      enforceRateLimit({ scope, subject: value, limit: 2, windowSeconds: 60 }),
    ).resolves.toBeUndefined();
    await expect(
      enforceRateLimit({ scope, subject: value, limit: 2, windowSeconds: 60 }),
    ).resolves.toBeUndefined();
    await expect(
      enforceRateLimit({ scope, subject: value, limit: 2, windowSeconds: 60 }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("peeking still refuses once the budget is spent", async () => {
    const value = subject("test-peek-full");
    const scope = "test-peek-full";
    await enforceRateLimit({ scope, subject: value, limit: 1, windowSeconds: 60 });
    await expect(
      peekRateLimit({ scope, subject: value, limit: 1 }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("keeps separate scopes independent", async () => {
    const value = crypto.randomUUID().slice(0, 12);
    subjects.push(["test-scope-a", value], ["test-scope-b", value]);
    await enforceRateLimit({ scope: "test-scope-a", subject: value, limit: 1, windowSeconds: 60 });
    await expect(
      enforceRateLimit({ scope: "test-scope-a", subject: value, limit: 1, windowSeconds: 60 }),
    ).rejects.toBeInstanceOf(RateLimitError);
    // A spent abuse-control budget must not spend the product budget with it.
    await expect(
      enforceRateLimit({ scope: "test-scope-b", subject: value, limit: 1, windowSeconds: 60 }),
    ).resolves.toBeUndefined();
  });
});
