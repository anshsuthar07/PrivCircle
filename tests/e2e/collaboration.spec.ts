import { expect, test } from "@playwright/test";

test("protected room stays disconnected until auth and syncs two editors", async ({
  browser,
}) => {
  const creator = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const first = await creator.newPage();
  const path = `secure-${crypto.randomUUID().slice(0, 8)}`;

  await first.goto("/");
  await first.getByLabel("Room path").fill(path);
  await first.getByText("Password protected").click();
  await first.getByLabel("Password", { exact: true }).fill("testing123");
  await first.getByLabel("Delete after inactivity").selectOption("1h");
  await first.getByRole("button", { name: "Create private room" }).click();
  await expect(first).toHaveURL(new RegExp(`/${path}$`));
  await expect(first.locator(".cm-content")).toBeVisible();

  const guest = await browser.newContext();
  const second = await guest.newPage();
  let websocketCount = 0;
  second.on("websocket", (socket) => {
    if (socket.url().includes(":1234") || socket.url().includes("/api/ws/")) {
      websocketCount += 1;
    }
  });
  await second.goto(`/${path}`);
  await expect(second.getByRole("heading", { name: "Password required" })).toBeVisible();
  await expect(second.locator(".cm-content")).toHaveCount(0);
  expect(websocketCount).toBe(0);

  await second.getByLabel("Room password").fill("incorrect1");
  await second.getByRole("button", { name: "Join room" }).click();
  await expect(second.getByText("Incorrect password. Please try again.")).toBeVisible();
  expect(websocketCount).toBe(0);

  await second.getByLabel("Room password").fill("testing123");
  await second.getByRole("button", { name: "Join room" }).click();
  await expect(second.locator(".cm-content")).toBeVisible();
  await expect(first.getByText("2 people connected")).toBeVisible();

  await first.locator(".cm-content").click();
  await first.keyboard.type('const message = "hello";');
  await expect(second.locator(".cm-content")).toContainText('const message = "hello";');

  await first.getByLabel("Shared language").selectOption("typescript");
  await expect(second.getByLabel("Shared language")).toHaveValue("typescript");

  await first.getByRole("button", { name: "Copy link" }).click();
  await expect(first.getByRole("button", { name: "Copied!" })).toBeVisible();

  const thirdContext = await browser.newContext();
  const third = await thirdContext.newPage();
  await third.goto(`/${path}`);
  await third.getByLabel("Room password").fill("testing123");
  await third.getByRole("button", { name: "Join room" }).click();
  await expect(third.getByRole("heading", { name: "Room is full" })).toBeVisible();

  await thirdContext.close();
  await guest.close();
  await creator.close();
});

test("unprotected room opens directly", async ({ page }) => {
  const path = `open-${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/");
  await page.getByLabel("Room path").fill(path);
  await page.getByLabel("Delete after inactivity").selectOption("1h");
  await page.getByRole("button", { name: "Create private room" }).click();
  await expect(page).toHaveURL(new RegExp(`/${path}$`));
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(page.getByText("1 person connected")).toBeVisible();
});
