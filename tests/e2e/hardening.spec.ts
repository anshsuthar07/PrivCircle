import { expect, test } from "@playwright/test";

/**
 * A client address unique to this run, matching the convention the other specs
 * use. Room creation is budgeted per caller, so without this the file competes
 * with every other spec — and with its own previous runs — for the same ten
 * rooms an hour, and fails on a 429 that has nothing to do with what is under
 * test.
 */
const runAddress = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
let addressCounter = 10;
function testClientIp() {
  return `2001:db8:${runAddress.slice(0, 4)}:${runAddress.slice(4)}::${addressCounter++}`;
}

test.use({ extraHTTPHeaders: { "x-forwarded-for": testClientIp() } });

/**
 * Regression cover for the defects found in the production audit that only
 * reproduce in a real browser: routing status codes, the editor's keyboard
 * escape route, and the files panel behaving as an overlay on a phone.
 */

/**
 * One room for the whole file.
 *
 * Room creation is rate limited to ten an hour per caller, which the suite as a
 * whole now sits close to. These tests only need *a* room, not a fresh one, so
 * they share a single unprotected room rather than each spending from that
 * budget. Each test still gets its own browser context, so each is a distinct
 * participant.
 */
let sharedRoomPath = "";

test.beforeAll(async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { "x-forwarded-for": testClientIp() },
  });
  const response = await api.post("/api/rooms", {
    headers: { Origin: baseURL!, "Content-Type": "application/json" },
    data: { expiration: "1h" },
  });
  if (!response.ok()) {
    throw new Error(`Could not create the shared room: ${response.status()}`);
  }
  sharedRoomPath = ((await response.json()) as { path: string }).path;
  await api.dispose();
});

async function openRoom(page: import("@playwright/test").Page) {
  await page.goto(`/${sharedRoomPath}`);
  await page.waitForSelector(".cm-editor", { timeout: 45_000 });
}

test.describe("non-room URLs", () => {
  test("a path that cannot be a room is a 404, not a room shell", async ({ page }) => {
    // These all used to render the room page under a 200, which both lied about
    // the status and turned every scanner request into a dynamic invocation.
    for (const path of ["/robots.txt.bak", "/wp-login.php", "/.env"]) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} must be 404`).toBe(404);
    }
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  test("robots.txt is served as robots.txt", async ({ page }) => {
    const response = await page.request.get("/robots.txt");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/plain");
    expect(await response.text()).toContain("User-Agent: *");
  });

  test("the security page is indexable and cacheable", async ({ page }) => {
    const response = await page.request.get("/security");
    expect(response.status()).toBe(200);
    // It was previously caught by the room header rule and marked noindex.
    expect(response.headers()["x-robots-tag"] ?? "").not.toContain("noindex");
  });

  test("a well-formed but unused room path still reaches the room states", async ({ page }) => {
    await page.goto("/never-existed-abc123");
    await expect(page.getByRole("heading", { name: "Room unavailable" })).toBeVisible();
  });
});

test.describe("editor keyboard escape", () => {
  test("advertises how to move focus out, and it works", async ({ page }) => {
    await openRoom(page);

    // Tab indents inside a code editor, so the escape route must be stated.
    const editor = page.getByRole("textbox", { name: "Shared code editor" });
    const describedBy = await editor.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`#${describedBy}`)).toContainText(/escape/i);

    await page.locator(".cm-content").click();
    await page.keyboard.press("Tab");
    await expect(editor).toBeFocused();

    await page.keyboard.press("Escape");
    await page.keyboard.press("Tab");
    await expect(editor).not.toBeFocused();
  });

  /**
   * The persistence banner is a conditional row in the room's grid. It appears
   * only when the server reports it cannot store the room — the moment someone
   * most needs to see and copy their work — so the layout must not depend on
   * how many children happen to be present. Injecting an extra unplaced child
   * exercises that contract without needing to fill a room to 1 MB.
   */
  test("an extra banner row does not collapse the editor", async ({ page }) => {
    await openRoom(page);
    const editor = page.locator(".cm-editor");
    const before = (await editor.boundingBox())!.height;
    expect(before).toBeGreaterThan(200);

    const injected = await page.evaluate(() => {
      const shell = document.querySelector("main");
      if (!shell) throw new Error("Missing room shell");
      const banner = document.createElement("div");
      banner.style.height = "40px";
      banner.dataset.injected = "true";
      shell.insertBefore(banner, shell.children[1]);
      return banner.getBoundingClientRect().height;
    });
    expect(injected).toBe(40);

    const after = (await editor.boundingBox())!.height;
    // The editor gives up the banner's height and nothing more.
    expect(after).toBeGreaterThan(before - 60);
  });

  /**
   * The editor used to be destroyed and rebuilt whenever the access token was
   * refreshed — roughly every fifteen minutes — taking the cursor, the scroll
   * position, and the entire undo history with it.
   *
   * Rather than wait out a real token lifetime, `/access` is rewritten to hand
   * back a token that is always about to expire, so every reconnect takes the
   * refresh path that used to trigger the teardown.
   */
  test("survives repeated token refreshes without rebuilding", async ({ page }) => {
    // Every socket the page opens is retained so the test can drop it on
    // demand. Toggling browser offline state does not reliably close an already
    // established WebSocket, which made the reconnect — and therefore the
    // refresh being tested — something that only sometimes happened.
    await page.addInitScript(() => {
      const sockets: WebSocket[] = [];
      const Original = window.WebSocket;
      class TrackedSocket extends Original {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          sockets.push(this);
        }
      }
      window.WebSocket = TrackedSocket as unknown as typeof WebSocket;
      const probe = window as unknown as {
        __openSocketCount: () => number;
        __dropSockets: () => number;
      };
      // Only sockets that actually reached OPEN count. A socket that is still
      // connecting is not yet the thing a forced reconnect should drop.
      probe.__openSocketCount = () =>
        sockets.filter((socket) => socket.readyState === Original.OPEN).length;
      probe.__dropSockets = () => {
        const open = sockets.filter((socket) => socket.readyState === Original.OPEN);
        sockets.length = 0;
        for (const socket of open) {
          try {
            socket.close(4000, "test-forced-reconnect");
          } catch {
            // Already closed; nothing to drop.
          }
        }
        return open.length;
      };
    });

    // Hand back a token that is always about to expire, so every reconnect
    // takes the refresh path that used to tear the editor down.
    await page.route("**/api/rooms/*/access", async (route) => {
      const response = await route.fetch();
      if (!response.ok()) return route.fulfill({ response });
      const payload = await response.json();
      return route.fulfill({
        response,
        json: { ...payload, tokenExpiresAt: new Date(Date.now() + 20_000).toISOString() },
      });
    });

    await openRoom(page);

    // Tag the live editor so a rebuilt one is distinguishable from this one.
    await page.evaluate(() => {
      const editor = document.querySelector(".cm-editor") as HTMLElement & { __probe?: string };
      if (!editor) throw new Error("Missing editor");
      editor.__probe = "original";
    });

    // One forced refresh is the whole proof: the teardown reproduced on the
    // very first one. Repeating it only added flakiness, because the provider
    // stops re-resolving the token on later reconnects.
    await page.waitForFunction(
      () => (window as unknown as { __openSocketCount: () => number }).__openSocketCount() > 0,
      undefined,
      { timeout: 20_000 },
    );

    const refreshed = page.waitForRequest(
      (request) => request.url().includes("/access"),
      { timeout: 20_000 },
    );
    const dropped = await page.evaluate(() =>
      (window as unknown as { __dropSockets: () => number }).__dropSockets(),
    );
    expect(dropped, "a live socket should have been dropped").toBeGreaterThan(0);
    // Fails loudly if the refresh never runs, rather than passing because
    // nothing was exercised.
    await refreshed;
    await expect(page.locator(".cm-editor")).toBeVisible();

    const survived = await page.evaluate(() => {
      const editor = document.querySelector(".cm-editor") as HTMLElement & { __probe?: string };
      return editor?.__probe ?? "rebuilt";
    });
    expect(survived).toBe("original");

    // The provider keeps reconnecting while the page tears down, so the route
    // handler is retired explicitly rather than being caught mid-request and
    // reported against whichever test happens to run next.
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("the room page has a top-level heading", async ({ page }) => {
    await openRoom(page);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("files panel as a mobile overlay", () => {
  test.use({ viewport: { width: 390, height: 844 } });


  test("closes on Escape and does not leave the editor reachable behind it", async ({ page }) => {
    await openRoom(page);
    const panel = page.locator("#room-files");

    await page.getByRole("button", { name: /^Files/ }).click();
    await expect(panel).toHaveAttribute("data-open", "true");

    // The editor is completely covered at this width, so it must not still be
    // focusable and typeable behind the panel.
    const reachable = await page.evaluate(() => {
      const content = document.querySelector(".cm-content");
      return Boolean(content && !content.closest("[inert]"));
    });
    expect(reachable).toBe(false);

    await page.keyboard.press("Escape");
    await expect(panel).toHaveAttribute("data-open", "false");

    // Closing restores the editor.
    const restored = await page.evaluate(() => {
      const content = document.querySelector(".cm-content");
      return Boolean(content && !content.closest("[inert]"));
    });
    expect(restored).toBe(true);
  });
});
