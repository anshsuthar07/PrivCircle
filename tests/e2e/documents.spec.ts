import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const runAddress = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
let ipCounter = 80;
function testClientIp() {
  return `2001:db8:${runAddress.slice(0, 4)}:${runAddress.slice(4)}::${ipCounter++}`;
}

async function expectNoSeriousAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      ({ impact }) => impact === "critical" || impact === "serious",
    ),
  ).toEqual([]);
}

async function openRoom(page: Page) {
  const path = `files-${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/");
  await page.getByLabel("Room name").fill(path);
  // The mode toggle carries the same label, so target the form submit itself.
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(new RegExp(`/${path}$`));
  await expect(page.locator(".cm-content")).toBeVisible();
  return path;
}

test("files panel opens from the room without disturbing the editor", async ({
  browser,
}) => {
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": testClientIp() },
  });
  const page = await context.newPage();
  await openRoom(page);

  const panel = page.locator("#room-files");
  const filesButton = page.getByRole("button", { name: "Files", exact: true });

  await expect(filesButton).toBeVisible();
  await expect(panel).toBeHidden();

  await filesButton.click();
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Files" })).toBeVisible();
  await expect(panel).toContainText("Temporary");

  // Either the upload affordance or the unconfigured notice, depending on
  // whether this environment has a blob store. Both are valid, shipped states.
  const dropzone = panel.getByRole("button", { name: "Upload files" });
  const unavailable = panel.getByText("File sharing is not configured");
  await expect(dropzone.or(unavailable).first()).toBeVisible();

  await expectNoSeriousAxeViolations(page);

  // The room has to stay usable while the panel is open: this is the property
  // that matters during a long upload.
  await page.locator(".cm-content").click();
  await page.keyboard.type("still editable");
  await expect(page.locator(".cm-content")).toContainText("still editable");

  await panel.getByRole("button", { name: "Close files" }).click();
  await expect(panel).toBeHidden();

  await context.close();
});

test("documents endpoints refuse a room the caller has not unlocked", async ({
  browser,
}) => {
  const creator = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": testClientIp() },
  });
  const first = await creator.newPage();
  const path = `locked-${crypto.randomUUID().slice(0, 8)}`;

  await first.goto("/");
  await first.getByLabel("Room name").fill(path);
  await first.getByRole("checkbox", { name: /Password protected/ }).check();
  await first.getByLabel("Password", { exact: true }).fill("testing123!");
  // Password strength is evaluated asynchronously, so submitting before the
  // button enables would silently do nothing.
  const createButton = first.getByRole("button", { name: "Create protected room" });
  await expect(createButton).toBeEnabled();
  await createButton.click();
  await expect(first).toHaveURL(new RegExp(`/${path}$`));

  // A different browser context has no grant, so every document operation on
  // the protected room must be refused by the same late-join guard that keeps
  // the editor closed.
  const outsider = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": testClientIp() },
  });
  const second = await outsider.newPage();
  await second.goto(`/${path}`);
  await expect(second.getByText("Password required")).toBeVisible();

  const list = await second.request.get(`/api/rooms/${path}/documents`);
  expect(list.status()).toBe(401);
  expect((await list.json()).code).toBe("PASSWORD_REQUIRED");

  const upload = await second.request.post(`/api/rooms/${path}/documents`, {
    data: { filename: "secret.pdf", size: 1024 },
  });
  expect(upload.status()).toBe(401);

  const download = await second.request.get(
    `/api/rooms/${path}/documents/${crypto.randomUUID()}/download`,
    { maxRedirects: 0 },
  );
  expect(download.status()).toBe(401);

  await creator.close();
  await outsider.close();
});

test("upload initiation rejects a file larger than 300 MB", async ({ browser }) => {
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": testClientIp() },
  });
  const page = await context.newPage();
  const path = await openRoom(page);

  const limit = 300 * 1024 * 1024;

  // Bypasses the browser entirely, which is the point: the client-side size
  // check is a convenience and the server must stand on its own.
  const oversized = await page.request.post(`/api/rooms/${path}/documents`, {
    data: { filename: "huge.zip", size: limit + 1 },
  });
  expect(oversized.status()).toBe(413);
  expect((await oversized.json()).code).toBe("FILE_TOO_LARGE");

  const traversal = await page.request.post(`/api/rooms/${path}/documents`, {
    data: { filename: "../../../etc/passwd", size: 1024 },
  });
  // Either accepted with a sanitized key, or refused because storage is not
  // configured here. What must never happen is a 5xx or an escaped path.
  expect([201, 503]).toContain(traversal.status());
  if (traversal.status() === 201) {
    const created = await traversal.json();
    expect(created.storageKey).not.toContain("..");
    expect(created.storageKey).toMatch(/^rooms\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/passwd$/);
  }

  await context.close();
});

/**
 * Round-trips a real file through the browser.
 *
 * This is the test that catches a Content-Security-Policy that forgets one of
 * the storage hosts: the upload SDK retries network failures, so a blocked
 * request surfaces as an upload stuck at 0% rather than an error. Skipped when
 * the environment has no blob store, which is the case in CI.
 */
async function openFilesPanel(page: Page) {
  await page.getByRole("button", { name: "Files", exact: true }).click();
  const panel = page.locator("#room-files");
  await expect(panel).toBeVisible();
  const unconfigured = await panel.getByText("File sharing is not configured").count();
  return { panel, configured: unconfigured === 0 };
}

for (const variant of [
  { label: "small file, single request", bytes: 9_000 },
  { label: "large file, multipart", bytes: 12 * 1024 * 1024 },
]) {
  test(`uploads and downloads a ${variant.label}`, async ({ browser }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext();

    // Scoped to this origin on purpose. `extraHTTPHeaders` would attach the
    // header to the cross-origin upload as well, which turns it into a CORS
    // preflight the storage host rejects.
    const clientIp = testClientIp();
    await context.route("http://localhost:3000/**", (route) =>
      route.continue({
        headers: { ...route.request().headers(), "x-forwarded-for": clientIp },
      }),
    );

    const page = await context.newPage();

    const cspViolations: string[] = [];
    page.on("console", (message) => {
      if (message.text().includes("Content Security Policy")) {
        cspViolations.push(message.text());
      }
    });

    await openRoom(page);
    const { panel, configured } = await openFilesPanel(page);
    test.skip(!configured, "No blob store configured in this environment");

    const marker = crypto.randomUUID();
    const body = Buffer.concat([
      Buffer.from(marker),
      Buffer.alloc(Math.max(0, variant.bytes - marker.length), 65),
    ]);
    const filename = `probe-${marker.slice(0, 8)}.txt`;

    await panel.locator("input[type=file]").setInputFiles({
      name: filename,
      mimeType: "text/plain",
      buffer: body,
    });

    // Wait on the download link, not the filename: the filename also appears on
    // the in-progress upload row, so matching it would pass mid-upload. The link
    // exists only once the server has confirmed the object's real size.
    const downloadLink = panel.locator("a[download]").first();
    await expect(downloadLink).toBeVisible({ timeout: 150_000 });
    expect(cspViolations, "a blocked host would stall the upload").toEqual([]);

    const href = await downloadLink.getAttribute("href");
    expect(href).toContain("/documents/");

    const downloaded = await page.request.get(href!);
    expect(downloaded.status()).toBe(200);
    const received = await downloaded.body();
    expect(received.length).toBe(body.length);
    expect(received.subarray(0, marker.length).toString()).toBe(marker);

    // Removing it should take it out of the room immediately. Deletion is
    // irreversible and shared, so it asks once before acting.
    await panel.getByRole("button", { name: `Remove ${filename}` }).click();
    await panel
      .getByRole("group", { name: `Confirm removing ${filename}` })
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(panel.locator("a[download]")).toHaveCount(0, { timeout: 30_000 });

    const afterDelete = await page.request.get(href!);
    expect(afterDelete.status()).toBe(404);

    await context.close();
  });
}
