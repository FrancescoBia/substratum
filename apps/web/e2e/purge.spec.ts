import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { resetLibrary, uploadImages, visibleImageIds } from "./helpers";

const DATA_DIR = ".playwright-data";

/**
 * The sweep only acts on Images trashed longer ago than the retention window, so
 * the test reaches into the database to backdate one. Shortening the window
 * instead would test different arithmetic than production runs.
 */
function backdateTrashedImage(id: string, daysAgo: number) {
  const db = new Database(join(DATA_DIR, "library.db"));
  try {
    const deletedAt = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
    db.prepare("update images set deleted_at = ? where id = ?").run(deletedAt, id);
  } finally {
    db.close();
  }
}

function storedFilesExist(id: string) {
  return existsSync(join(DATA_DIR, "images", id));
}

test.beforeEach(async ({ request }) => {
  await resetLibrary(request);
});

test("recently trashed images survive the sweep", async ({ page, request }) => {
  await uploadImages(request, 1);
  await page.goto("/");
  const [id] = await visibleImageIds(page);

  await request.post(`/image/${id}`, { form: { intent: "trash" } });

  // Long enough for at least one sweep at the test interval.
  await page.waitForTimeout(2500);

  await page.goto("/trash");
  await expect(page.locator("main img")).toHaveCount(1);
  expect(storedFilesExist(id)).toBe(true);
});

test("images past the retention window are purged, files and all", async ({ page, request }) => {
  await uploadImages(request, 2);
  await page.goto("/");
  const ids = await visibleImageIds(page);
  const [doomed, kept] = ids;

  await request.post(`/image/${doomed}`, { form: { intent: "trash" } });
  await request.post(`/image/${kept}`, { form: { intent: "trash" } });
  expect(storedFilesExist(doomed)).toBe(true);

  backdateTrashedImage(doomed, 40);

  await expect
    .poll(() => storedFilesExist(doomed), { timeout: 10_000, message: "stored files removed" })
    .toBe(false);

  await page.goto("/trash");
  await expect(page.locator("main img")).toHaveCount(1);

  // The one trashed today is untouched — the sweep is selective, not a wipe.
  expect(storedFilesExist(kept)).toBe(true);
});
