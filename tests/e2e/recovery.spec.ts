import { expect, test } from "@playwright/test";

const runAddress = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
let ipCounter = 80;

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `2001:db8:${runAddress.slice(0, 4)}:${runAddress.slice(4)}::${ipCounter++}`,
  });
});

test("reserved paths are normalized and reported at the field", async ({ page }) => {
  await page.goto("/");
  const input = page.getByLabel("Room name");
  await input.fill("  SECURITY  ");
  await input.blur();
  await expect(input).toHaveValue("security");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("That link name is reserved.")).toBeVisible();
});

test("room collision focuses the field and offers a full-size recovery action", async ({ page }) => {
  const path = `collision-${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/");
  await page.getByLabel("Room name").fill(path);
  await page.locator(".create-form .primary-button").click();
  await expect(page).toHaveURL(new RegExp(`/${path}$`));

  await page.goto("/");
  const input = page.getByLabel("Room name");
  await input.fill(path);
  await page.locator(".create-form .primary-button").click();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  const recovery = page.getByRole("button", { name: "Join existing room" });
  await expect(recovery).toBeVisible();
  await expect(recovery).toHaveCSS("min-height", "44px");
});

test("rate-limit failures expose retryable feedback", async ({ page }) => {
  await page.route(/\/api\/rooms$/, async (route) => {
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({
        code: "RATE_LIMITED",
        message: "Too many requests. Please wait and try again.",
      }),
    });
  });
  await page.goto("/");
  await page.getByLabel("Room name").fill("rate-limited-room");
  await page.locator(".create-form .primary-button").click();
  await expect(page.locator('.create-form [role="alert"]')).toContainText("Too many requests");
});

test("clipboard rejection reveals and focuses a selectable room URL", async ({ page }) => {
  const path = `clipboard-${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/");
  await page.getByLabel("Room name").fill(path);
  await page.locator(".create-form .primary-button").click();
  await expect(page.getByRole("textbox", { name: "Shared code editor" })).toBeVisible();

  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
  });
  await page.getByRole("button", { name: "Copy link" }).click();
  const fallback = page.getByLabel("Room link", { exact: true });
  await expect(fallback).toBeVisible();
  await expect(fallback).toBeFocused();
  await expect(page.locator('.sr-only[role="status"]')).toContainText("Copy failed");
});
