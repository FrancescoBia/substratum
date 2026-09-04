import { expect, test } from "@playwright/test";
import {
  createBoard,
  dropFiles,
  openDetails,
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
    await openDetails(page);
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
    await openDetails(page);

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
    await openDetails(page);

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

    await openDetails(page);
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

    await openDetails(page);
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

test.describe("Full-size view", () => {
  test("a tile opens the image over the grid and arrows walk it", async ({ page, request }) => {
    await uploadImages(request, 3);
    await page.goto("/");
    const ids = await visibleImageIds(page);

    await page.locator("main a").first().click();
    await expect(page).toHaveURL(new RegExp(`\\?view=${ids[0]}`));

    const viewer = page.getByRole("dialog");
    await expect(viewer.locator("img")).toHaveAttribute("src", `/img/${ids[0]}/medium`);
    await expect(viewer.getByText("1 / 3")).toBeVisible();
    // The grid is still there underneath, as it is behind the detail panel.
    await expect(page.locator("main img")).toHaveCount(3);

    // Stepping moves `?view=`, which no loader reads. If a route ever forgets
    // its `shouldRevalidate`, walking the grid re-fetches it on every keypress.
    const loaderFetches: string[] = [];
    page.on("request", (request) => {
      const kind = request.resourceType();
      if (kind === "fetch" || kind === "xhr" || kind === "document") {
        loaderFetches.push(request.url());
      }
    });

    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(new RegExp(`\\?view=${ids[1]}`));
    await expect(viewer.getByText("2 / 3")).toBeVisible();
    expect(loaderFetches).toEqual([]);

    // Stepping past the first image wraps round to the last.
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(viewer.getByText("3 / 3")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();
    await expect(page).not.toHaveURL(/view=/);
  });

  test("leads through to the detail panel", async ({ page, request }) => {
    await uploadImages(request, 1);
    await page.goto("/");
    await page.locator("main a").first().click();

    await page.getByRole("dialog").getByRole("link", { name: "Details" }).click();

    // Handing over rather than stacking: the viewer's param goes as the panel's
    // arrives, so only one of the two is ever open.
    await expect(page).toHaveURL(/\?image=/);
    await expect(page).not.toHaveURL(/view=/);
    await expect(page.getByText("Uploaded — no source page")).toBeVisible();
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

  test("a board drop asks whether to add the imported images", async ({ page, request }) => {
    const boardId = await createBoard(request, "Moodboard");
    await page.goto(`/boards/${boardId}`);

    const first = await png(500, 700, [120, 90, 200]);
    await dropFiles(page, [{ name: "stream-only.png", base64: first.toString("base64") }]);

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Import 1 image?" })).toBeVisible();
    await expect(dialog).toContainText("Moodboard");
    await expect(page.locator("main img")).toHaveCount(0);

    await dialog.getByRole("button", { name: "Import only" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("main img")).toHaveCount(0);

    const second = await png(700, 500, [20, 140, 80]);
    const third = await png(600, 600, [210, 110, 40]);
    await dropFiles(page, [
      { name: "on-board-1.png", base64: second.toString("base64") },
      { name: "on-board-2.png", base64: third.toString("base64") },
    ]);
    await expect(page.getByRole("heading", { name: "Import 2 images?" })).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Import and add to board" })
      .click();

    await expect(page.locator("main img")).toHaveCount(2);
    await page.goto("/");
    await expect(page.locator("main img")).toHaveCount(3);
  });

  test("publishing shows a link to the address the app is served on", async ({
    page,
    request,
  }) => {
    const boardId = await createBoard(request, "Shareable");
    await page.goto(`/boards/${boardId}`);
    await page.getByRole("button", { name: "Publish" }).click();

    // The regression this guards: the link used to be built from a hardcoded
    // port, so on any other one it pointed at whatever else was listening.
    const origin = new URL(page.url()).origin;
    await expect(page.getByText(`${origin}/board/shareable`)).toBeVisible();
  });

  test("deleting one keeps its images", async ({ page, request }) => {
    await uploadImages(request, 1);
    const boardId = await createBoard(request, "Temporary");
    await page.goto("/");
    await openDetails(page);
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

test.describe("Tags", () => {
  test("a tag drop asks whether to tag the imported images", async ({ page, request }) => {
    // The tag has to exist before it can be a drop destination, and the panel is
    // the only way in — Tags are created by first use, not up front.
    await uploadImages(request, 1);
    await page.goto("/");
    await openDetails(page);
    const panel = page.getByRole("dialog");
    await panel.getByPlaceholder("Add a tag…").fill("palette");
    await panel.getByPlaceholder("Add a tag…").press("Enter");
    await expect(panel.getByText("palette ×")).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto("/tag/palette");
    await expect(page.locator("main img")).toHaveCount(1);

    const first = await png(500, 700, [120, 90, 200]);
    await dropFiles(page, [{ name: "stream-only.png", base64: first.toString("base64") }]);

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Import 1 image?" })).toBeVisible();
    await expect(dialog).toContainText("#palette");

    await dialog.getByRole("button", { name: "Import only" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator("main img")).toHaveCount(1);

    const second = await png(700, 500, [20, 140, 80]);
    const third = await png(600, 600, [210, 110, 40]);
    await dropFiles(page, [
      { name: "tagged-1.png", base64: second.toString("base64") },
      { name: "tagged-2.png", base64: third.toString("base64") },
    ]);
    await expect(page.getByRole("heading", { name: "Import 2 images?" })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Import and tag" }).click();

    await expect(page.locator("main img")).toHaveCount(3);
    await page.goto("/");
    await expect(page.locator("main img")).toHaveCount(4);
    await expect(page.getByRole("link", { name: /palette/ })).toContainText("3");
  });
});
