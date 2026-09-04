import { expect, test } from "@playwright/test";
import {
  createBoard,
  dropFiles,
  png,
  resetLibrary,
  uploadImages,
  visibleImageIds,
} from "./helpers";

// One instance and one database are shared, so each test clears the library
// first — otherwise counts depend on which tests ran before.
test.beforeEach(async ({ request }) => {
  await resetLibrary(request);
});

test.describe("Stream and upload", () => {
  test("an empty instance explains both ways in", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Your Stream is empty" })).toBeVisible();
    await expect(page.getByText(/Drag images anywhere/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Stream/ })).toBeVisible();
  });

  test("uploaded images appear in the grid", async ({ page, request }) => {
    await uploadImages(request, 3);
    await page.goto("/");

    await expect(page.getByText("3 images")).toBeVisible();
    await expect(page.locator("main img")).toHaveCount(3);

    // Thumbnails must be served, not broken — a 404 would still render an <img>.
    const loaded = await page.locator("main img").first().evaluate((node) => {
      const image = node as HTMLImageElement;
      return image.complete && image.naturalWidth > 0;
    });
    expect(loaded).toBe(true);
  });

  test("switches between flat and mosaic layouts and remembers the choice", async ({
    page,
    request,
  }) => {
    await uploadImages(request, 3);
    const boardId = await createBoard(request, "Layout test");
    await page.goto("/");

    const flatButton = page.getByRole("button", { name: "Flat grid" });
    const mosaicButton = page.getByRole("button", { name: "Mosaic" });
    await expect(flatButton).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-layout="flat"]')).toBeVisible();

    // File an image so the same preference can be checked in a Board view.
    await page.locator("main a").first().click();
    await page.getByRole("dialog").getByRole("checkbox").first().click();
    await page.keyboard.press("Escape");

    await mosaicButton.click();
    await expect(mosaicButton).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-layout="mosaic"]')).toBeVisible();
    await expect(page.locator('[data-layout="mosaic"] img').first()).toHaveClass(/h-auto/);

    await page.goto(`/boards/${boardId}`);
    await expect(page.getByRole("button", { name: "Mosaic" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.locator('[data-layout="mosaic"]')).toBeVisible();
  });

  test("dropping files on the page uploads them", async ({ page }) => {
    await page.goto("/");
    const before = (await visibleImageIds(page)).length;

    const buffer = await png(500, 700, [120, 90, 200]);
    await dropFiles(page, [{ name: "dropped.png", base64: buffer.toString("base64") }]);

    await expect(page.locator("main img")).toHaveCount(before + 1);
  });
});

test.describe("Detail panel", () => {
  test("opens over the grid and shows an uploaded image has no source", async ({
    page,
    request,
  }) => {
    await uploadImages(request, 1);
    await page.goto("/");
    await page.locator("main a").first().click();

    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Uploaded — no source page")).toBeVisible();
    // The grid stays put behind it — the reason this shape won the prototype.
    await expect(page.locator("main img").first()).toBeVisible();
    await expect(page).toHaveURL(/\?image=/);
  });

  test("tagging from the panel updates the sidebar", async ({ page, request }) => {
    await uploadImages(request, 1);
    await page.goto("/");
    await page.locator("main a").first().click();

    const panel = page.getByRole("dialog");
    await panel.getByPlaceholder("Add a tag…").fill("Editorial Layout");
    await panel.getByPlaceholder("Add a tag…").press("Enter");

    // Normalized to lowercase and hyphenated on the way in.
    await expect(panel.getByText("editorial-layout ×")).toBeVisible();

    // The panel is a modal, so everything behind it is aria-hidden — the
    // sidebar is only reachable by role once it's closed.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("link", { name: /editorial-layout/ })).toBeVisible();
  });

  test("assigning a board updates its sidebar count and view", async ({ page, request }) => {
    await uploadImages(request, 2);
    await createBoard(request, "Dark UI");
    await page.goto("/");

    await page.locator("main a").first().click();
    const panel = page.getByRole("dialog");
    await panel.getByRole("checkbox").first().click();
    await page.keyboard.press("Escape");

    const boardLink = page.getByRole("link", { name: /Dark UI/ });
    await expect(boardLink).toContainText("1");

    await boardLink.click();
    await expect(page.getByRole("heading", { name: "Dark UI" })).toBeVisible();
    await expect(page.locator("main img")).toHaveCount(1);
  });

  test("trashing removes it from the Stream and it can be restored", async ({ page, request }) => {
    await uploadImages(request, 2);
    await page.goto("/");

    await page.locator("main a").first().click();
    await page.getByRole("dialog").getByRole("button", { name: /Move to Trash/ }).click();

    await expect(page.locator("main img")).toHaveCount(1);

    await page.getByRole("link", { name: /Trash/ }).click();
    await expect(page.getByRole("heading", { name: "Trash" })).toBeVisible();
    await page.locator("main .group").first().hover();
    await page.getByRole("button", { name: /Restore/ }).first().click();

    await page.getByRole("link", { name: /Stream/ }).click();
    await expect(page.locator("main img")).toHaveCount(2);
  });
});

test.describe("Triage", () => {
  test("only offered when something is untriaged", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: /Triage/ })).toBeHidden();

    await uploadImages(request, 2);
    await page.reload();
    await expect(page.getByRole("link", { name: /Triage/ })).toBeVisible();
  });

  test("number keys file an image and the queue advances", async ({ page, request }) => {
    await uploadImages(request, 2);
    await createBoard(request, "Typography");
    await page.goto("/triage");

    await expect(page.getByText("1 of 2")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Triage" })).toBeVisible();

    // "1" toggles the first board without touching the mouse.
    await page.keyboard.press("1");
    await expect(page.getByRole("checkbox").first()).toBeChecked();

    // Filing an image revalidates the loader, which shrinks its untriaged
    // queue. Waiting for that to land first is what makes this a regression
    // test for the queue being snapshotted rather than read live.
    await expect(page.getByRole("link", { name: /Typography/ })).toContainText("1");

    await page.keyboard.press("s");
    await expect(page.getByText("2 of 2")).toBeVisible();

    await page.keyboard.press("s");
    await expect(page.getByRole("heading", { name: "End of the queue" })).toBeVisible();

    await page.goto("/");
    await expect(page.getByRole("link", { name: /Typography/ })).toContainText("1");
  });
});

test.describe("Boards", () => {
  test("can be created from the sidebar", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "New board" }).click();
    await page.getByPlaceholder("Board name…").fill("Moodboard");
    await page.getByPlaceholder("Board name…").press("Enter");

    await expect(page.getByRole("link", { name: /Moodboard/ })).toBeVisible();
  });

  test("deleting one keeps its images", async ({ page, request }) => {
    await uploadImages(request, 1);
    const boardId = await createBoard(request, "Temporary");
    await page.goto("/");
    await page.locator("main a").first().click();
    await page.getByRole("dialog").getByRole("checkbox").first().click();
    await page.keyboard.press("Escape");

    await page.goto(`/boards/${boardId}`);
    page.on("dialog", (dialog) => dialog.accept());
    await page.locator("header").getByRole("button").last().click();

    await expect(page.getByRole("heading", { name: "Stream" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Temporary/ })).toBeHidden();
    await expect(page.locator("main img")).toHaveCount(1);
  });
});
