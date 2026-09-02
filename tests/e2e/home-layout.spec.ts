import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const viewports = [
  { width: 320, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1600, height: 900 },
] as const;

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function expectNoSeriousAxeViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(({ impact }) =>
    impact === "critical" || impact === "serious",
  );
  expect(blocking).toEqual([]);
}

/** The footer carries the only links to the security page and the source. */
async function footerIsVisible(page: import("@playwright/test").Page) {
  return page.locator("footer").first().isVisible();
}

async function chooseOption(
  page: import("@playwright/test").Page,
  label: string,
  option: string,
) {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

for (const viewport of viewports) {
  test(`homepage has intentional responsive order at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");

    await expectNoHorizontalOverflow(page);
    const positions = await page.evaluate(() => {
      const form = document.querySelector<HTMLElement>(".home-form-column");
      const proofHeading = document.getElementById("proof-title");
      const cta = document.querySelector<HTMLElement>(".primary-button");
      if (!form || !proofHeading || !cta) throw new Error("Missing homepage region");
      return {
        formTop: form.getBoundingClientRect().top,
        proofTop: proofHeading.getBoundingClientRect().top,
        ctaBottom: cta.getBoundingClientRect().bottom,
      };
    });

    if (viewport.width <= 1120) expect(positions.formTop).toBeLessThan(positions.proofTop);
    if (viewport.width === 320) expect(positions.ctaBottom).toBeLessThanOrEqual(800);
  });
}

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
] as const) {
  test(`expanded password form stays within ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByRole("checkbox", { name: /Password protected/ }).check();
    await chooseOption(page, "Room expiry", "No automatic expiry");

    const geometry = await page.evaluate(() => {
      const cta = document.querySelector<HTMLElement>(".primary-button");
      if (!cta) throw new Error("Missing primary action");
      return {
        clientHeight: document.documentElement.clientHeight,
        scrollHeight: document.documentElement.scrollHeight,
        ctaBottom: cta.getBoundingClientRect().bottom,
      };
    });

    // The property worth protecting is that the primary action is reachable
    // without scrolling, not that the page never scrolls at all.
    //
    // This previously asserted zero scroll height, which held only because the
    // footer — the sole route to the security page and the source — was hidden
    // at short desktop heights. Deleting navigation to avoid a scrollbar is the
    // worse failure of the two, so the footer stays and the page is allowed to
    // extend past the fold in this worst-case form state (password expanded and
    // the indefinite-retention warning shown).
    expect(geometry.ctaBottom).toBeLessThanOrEqual(geometry.clientHeight);
    expect(await footerIsVisible(page)).toBe(true);
  });
}

test("expanded password and indefinite retention remain usable on narrow mobile", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await page.getByRole("checkbox", { name: /Password protected/ }).check();
  await chooseOption(page, "Room expiry", "No automatic expiry");
  await expect(page).toHaveURL("/");

  await expect(page.locator(".password-criteria")).toBeVisible();
  await expect(page.locator(".lifetime-warning")).toContainText("no self-service deletion");
  await expectNoHorizontalOverflow(page);

  const undersized = await page.locator("main button, main input:not([type=checkbox]), main select, main summary").evaluateAll(
    (elements) => elements
      .filter((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return style.display !== "none" && box.width > 0 && box.height > 0;
      })
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width < 44 || box.height < 44;
      })
      .map((element) => `${element.tagName}:${element.getAttribute("aria-label") || element.textContent}`),
  );
  expect(undersized).toEqual([]);
});

test("join mode accepts this origin and rejects foreign room links", async ({ page }) => {
  await page.goto("/?action=join");
  await expect(page.getByRole("heading", { name: "Join a room" })).toBeVisible();
  const input = page.getByLabel("Room link");

  await input.fill("https://example.com/private-room");
  await expect(page.getByText(/Paste a link from this PrivCircle site/)).toBeVisible();
  await expect(page.locator(".create-form .primary-button")).toBeDisabled();

  await input.fill(`${new URL(page.url()).origin}/private-room`);
  await expect(page.locator(".create-form .primary-button")).toBeEnabled();
});

test("homepage create, join, expanded password, and validation states pass axe", async ({ page }) => {
  await page.goto("/");
  await expectNoSeriousAxeViolations(page);

  const roomInfo = page.getByRole("button", { name: "Room naming guidance" });
  await roomInfo.hover();
  await expect(
    page.getByRole("tooltip").filter({
      hasText: "Leave blank—we'll create a random room name for you.",
    }),
  ).toBeVisible();
  const retentionInfo = page.getByRole("button", {
    name: "Retention countdown information",
  });
  await retentionInfo.focus();
  await expect(
    page.getByRole("tooltip").filter({
      hasText: "The countdown starts after the last person disconnects",
    }),
  ).toBeVisible();

  const retention = page.getByRole("combobox", { name: "Room expiry" });
  await retention.focus();
  await retention.press("ArrowDown");
  await expect(retention).toHaveAttribute("aria-expanded", "true");
  await expectNoSeriousAxeViolations(page);
  await retention.press("Escape");
  await expect(retention).toHaveAttribute("aria-expanded", "false");
  await expect(retention).toBeFocused();

  await page.getByRole("checkbox", { name: /Password protected/ }).check();
  await expectNoSeriousAxeViolations(page);

  await page.getByRole("button", { name: "Join room", exact: true }).first().click();
  await page.getByLabel("Room link").fill("https://example.com/not-privcircle");
  await expectNoSeriousAxeViolations(page);
});
