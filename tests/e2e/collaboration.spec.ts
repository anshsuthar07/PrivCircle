import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ROOM_CAPACITY } from "@/lib/types";

const runAddress = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
let ipCounter = 10;
function testClientIp() {
  return `2001:db8:${runAddress.slice(0, 4)}:${runAddress.slice(4)}::${ipCounter++}`;
}

async function expectNoSeriousAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(({ impact }) => impact === "critical" || impact === "serious"),
  ).toEqual([]);
}

async function chooseOption(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("protected room stays disconnected until auth and syncs two editors", async ({
  browser,
}) => {
  const creator = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
    extraHTTPHeaders: { "x-forwarded-for": testClientIp() },
  });
  const first = await creator.newPage();
  const path = `secure-${crypto.randomUUID().slice(0, 8)}`;

  await first.goto("/");
  await first.getByLabel("Room name").fill(path);
  await first.getByRole("checkbox", { name: /Password protected/ }).check();
  const createButton = first.getByRole("button", { name: "Create protected room" });
  const passwordInput = first.getByLabel("Password", { exact: true });
  await expect(createButton).toBeDisabled();
  await passwordInput.fill("testing123");
  await expect(
    first.locator(".password-criteria li", { hasText: "One special character" }),
  ).not.toHaveClass(/criterion-met/);
  await expect(createButton).toBeDisabled();
  await passwordInput.fill("testing123!");
  await expect(first.getByText("Password strength").locator("..")).toContainText(
    "Strong",
  );
  await expect(first.locator(".password-criteria .criterion-met")).toHaveCount(4);
  await expect(createButton).toBeEnabled();
  await chooseOption(first, "Room expiry", "After 1 hour");
  await createButton.click();
  await expect(first).toHaveURL(new RegExp(`/${path}$`));
  await expect(first.locator(".cm-content")).toBeVisible();
  await expect(first.getByText("Room created — invite someone")).toBeVisible();
  await expect(first.getByRole("textbox", { name: "Shared code editor" })).toBeVisible();
  await expectNoSeriousAxeViolations(first);

  const guest = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": testClientIp() },
  });
  const second = await guest.newPage();
  let websocketCount = 0;
  second.on("websocket", (socket) => {
    if (socket.url().includes(":1234") || socket.url().includes("/api/ws/")) {
      websocketCount += 1;
    }
  });
  await second.goto("/");
  await second
    .locator(".room-action-switch")
    .getByRole("button", { name: "Join room" })
    .click();
  await expect(second.getByLabel("Room expiry")).toHaveCount(0);
  await second.getByLabel("Room link").fill(`${second.url()}${path}`);
  await second.locator(".create-form .primary-button").click();
  await expect(second).toHaveURL(new RegExp(`/${path}$`));
  await expect(second.getByRole("heading", { name: "Password required" })).toBeVisible();
  await expect(second.locator(".cm-content")).toHaveCount(0);
  expect(websocketCount).toBe(0);
  await expectNoSeriousAxeViolations(second);

  await second.getByLabel("Room password").fill("incorrect1");
  await second.getByRole("button", { name: "Join room" }).click();
  await expect(second.getByText("Incorrect password. Please try again.")).toBeVisible();
  expect(websocketCount).toBe(0);

  await second.getByLabel("Room password").fill("testing123!");
  await second.getByRole("button", { name: "Join room" }).click();
  await expect(second.locator(".cm-content")).toBeVisible();
  await expect(first.getByText(`2 of ${ROOM_CAPACITY} connected`)).toBeVisible();
  await expect(first.getByText("Room created — invite someone")).toHaveCount(0);

  await first.locator(".cm-content").click();
  await first.keyboard.type('const message = "hello";');
  await expect(second.locator(".cm-content")).toContainText('const message = "hello";');

  await chooseOption(first, "Shared language", "TypeScript");
  await expect(second.getByRole("combobox", { name: "Shared language" })).toContainText("TypeScript");

  await first.getByRole("button", { name: "Copy link" }).click();
  await expect(first.locator('.sr-only[role="status"]')).toContainText("Room link copied.");

  // A room is a group, not a pair: a third participant joins and edits like
  // anyone else. The seat ceiling itself is exercised against the Lua script in
  // the unit tests, where filling a room does not cost a browser per person.
  const thirdContext = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": testClientIp() },
  });
  const third = await thirdContext.newPage();
  await third.goto(`/${path}`);
  await third.getByLabel("Room password").fill("testing123!");
  await third.getByRole("button", { name: "Join room" }).click();
  await expect(third.locator(".cm-content")).toBeVisible();
  await expect(third.locator(".cm-content")).toContainText('const message = "hello";');
  await expect(first.getByText(`3 of ${ROOM_CAPACITY} connected`)).toBeVisible();

  // And their edits reach everyone already in the room.
  await third.locator(".cm-content").click();
  await third.keyboard.press("End");
  await third.keyboard.type(" // from the third");
  await expect(first.locator(".cm-content")).toContainText("// from the third");
  await expect(second.locator(".cm-content")).toContainText("// from the third");

  await thirdContext.close();
  await guest.close();
  await creator.close();
});

test("unprotected room opens directly", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": testClientIp() });
  const path = `open-${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/");
  await page.getByLabel("Room name").fill(path);
  await chooseOption(page, "Room expiry", "After 1 hour");
  await page.locator(".create-form .primary-button").click();
  await expect(page).toHaveURL(new RegExp(`/${path}$`));
  await expect(page.locator(".cm-content")).toBeVisible();
  // Presence is a fraction so the remaining room is visible before it runs out.
  await expect(page.getByText(`1 of ${ROOM_CAPACITY} connected`)).toBeVisible();
  await expect(page.getByText("Deletes 1 hour after everyone leaves")).toBeVisible();
});

test("mobile editor keeps actions reachable without horizontal overflow", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": testClientIp() });
  const path = `mobile-${crypto.randomUUID().slice(0, 8)}`;
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await page.getByLabel("Room name").fill(path);
  await page.locator(".create-form .primary-button").click();
  await expect(page.getByRole("textbox", { name: "Shared code editor" })).toBeVisible();

  const overflow = page.locator('summary[aria-label="Editor actions"]');
  await overflow.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^Wrap/ })).toBeVisible();
  await page.getByRole("button", { name: /^Wrap/ }).click();
  await expect(overflow).toBeFocused();

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});
