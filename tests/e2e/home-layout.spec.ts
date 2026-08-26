import { expect, Page, test } from "@playwright/test";

type Box = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

type HomeGeometry = {
  viewport: { width: number; height: number };
  scroll: { width: number; height: number };
  story: Box;
  card: Box;
  button: Box;
  assurances: Box;
  privacy: Box;
  cardOverflowY: string;
};

const supportedDesktopViewports = [
  { width: 1600, height: 900 },
  { width: 1366, height: 768 },
] as const;

async function readHomeGeometry(page: Page): Promise<HomeGeometry> {
  return page.evaluate(() => {
    function readBox(selector: string): Box {
      const element = document.querySelector<HTMLElement>(selector);

      if (!element) {
        throw new Error(`Missing layout element: ${selector}`);
      }

      const box = element.getBoundingClientRect();

      return {
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        left: box.left,
        width: box.width,
        height: box.height,
      };
    }

    const card = document.querySelector<HTMLElement>(".home-card");

    if (!card) {
      throw new Error("Missing home card");
    }

    return {
      viewport: {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      },
      scroll: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
      story: readBox(".home-story"),
      card: readBox(".home-card"),
      button: readBox(".primary-button"),
      assurances: readBox(".assurances"),
      privacy: readBox(".privacy-note"),
      cardOverflowY: getComputedStyle(card).overflowY,
    };
  });
}

function expectBoxToMatch(actual: Box, expected: Box) {
  for (const property of ["top", "right", "bottom", "left", "width", "height"] as const) {
    expect(Math.abs(actual[property] - expected[property])).toBeLessThanOrEqual(1);
  }
}

async function enablePassword(page: Page) {
  await page.getByText("Password protected").click();
  const passwordField = page.locator(".reveal-field");
  await expect(passwordField).toBeVisible();
  await passwordField.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
}

for (const viewport of supportedDesktopViewports) {
  test(`homepage remains fixed through every form state at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");

    const initial = await readHomeGeometry(page);
    const states = [initial];

    await enablePassword(page);
    states.push(await readHomeGeometry(page));

    await page.getByLabel("Delete after inactivity").selectOption("lifetime");
    await expect(page.locator(".lifetime-warning")).toBeVisible();
    const worstCase = await readHomeGeometry(page);
    states.push(worstCase);

    await page.getByText("Password protected").click();
    await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
    states.push(await readHomeGeometry(page));

    await enablePassword(page);
    states.push(await readHomeGeometry(page));

    await page
      .locator(".room-action-switch")
      .getByRole("button", { name: "Join room" })
      .click();
    await expect(page.getByLabel("Delete after inactivity")).toHaveCount(0);
    states.push(await readHomeGeometry(page));

    for (const state of states) {
      expectBoxToMatch(state.story, initial.story);
      expectBoxToMatch(state.card, initial.card);
      expect(state.scroll.height).toBeLessThanOrEqual(state.viewport.height);
      expect(state.scroll.width).toBeLessThanOrEqual(state.viewport.width);
      expect(state.card.bottom).toBeLessThanOrEqual(state.viewport.height);
    }

    expect(worstCase.button.bottom).toBeLessThanOrEqual(worstCase.assurances.top);
    expect(worstCase.assurances.bottom).toBeLessThanOrEqual(worstCase.privacy.top);
    expect(worstCase.privacy.bottom).toBeLessThanOrEqual(worstCase.card.bottom);
    expect(worstCase.cardOverflowY).toBe("visible");
  });
}

test("short desktop keeps the left stage fixed and falls back to document scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.getByLabel("Delete after inactivity").selectOption("lifetime");
  const initial = await readHomeGeometry(page);

  await enablePassword(page);
  const expanded = await readHomeGeometry(page);

  expectBoxToMatch(expanded.story, initial.story);
  expect(expanded.scroll.width).toBeLessThanOrEqual(expanded.viewport.width);
  expect(expanded.scroll.height).toBeGreaterThanOrEqual(expanded.viewport.height);
  expect(expanded.cardOverflowY).toBe("visible");

  await page.locator(".privacy-note").scrollIntoViewIfNeeded();
  await expect(page.locator(".privacy-note")).toBeInViewport();
  await expect(page.getByRole("button", { name: "Create private room" })).toBeVisible();
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 320, height: 800 },
] as const) {
  test(`homepage reflows without horizontal clipping at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await enablePassword(page);
    await page.getByLabel("Delete after inactivity").selectOption("lifetime");

    await expect(page.locator(".password-criteria")).toBeVisible();
    await expect(page.locator(".lifetime-warning")).toBeVisible();

    const geometry = await readHomeGeometry(page);
    expect(geometry.scroll.width).toBeLessThanOrEqual(geometry.viewport.width);
    expect(geometry.card.left).toBeGreaterThanOrEqual(0);
    expect(geometry.card.right).toBeLessThanOrEqual(geometry.viewport.width);
    expect(geometry.cardOverflowY).toBe("visible");

    await page.locator(".privacy-note").scrollIntoViewIfNeeded();
    await expect(page.locator(".privacy-note")).toBeInViewport();
  });
}
