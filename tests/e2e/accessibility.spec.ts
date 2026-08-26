import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectNoSeriousAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(({ impact }) => impact === "critical" || impact === "serious"),
  ).toEqual([]);
}

test("security documentation passes axe", async ({ page }) => {
  await page.goto("/security");
  await expect(page.getByRole("heading", { name: "Security and privacy" })).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});

for (const state of [
  {
    name: "expired",
    status: 410,
    code: "ROOM_EXPIRED",
    heading: "Room expired",
  },
  {
    name: "unavailable",
    status: 404,
    code: "ROOM_UNAVAILABLE",
    heading: "Room unavailable",
  },
  {
    name: "service-error",
    status: 503,
    code: "SERVICE_UNAVAILABLE",
    heading: "Unable to connect",
  },
] as const) {
  test(`${state.name} room recovery state passes axe`, async ({ page }) => {
    const path = `axe-${state.name}`;
    await page.route(`**/api/rooms/${path}`, async (route) => {
      await route.fulfill({
        status: state.status,
        contentType: "application/json",
        body: JSON.stringify({ code: state.code }),
      });
    });
    await page.goto(`/${path}`);
    await expect(page.getByRole("heading", { name: state.heading })).toBeVisible();
    await expectNoSeriousAxeViolations(page);
  });
}
