import { expect, test } from "@playwright/test";
import {
  captureImage,
  createBoard,
  detailsPanel,
  dropFiles,
  openDetails,
  openViewer,
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
    await expect(page.getByText(/Drag images or videos anywhere/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Stream/ })).toBeVisible();
  });

  test("uploaded images appear in the grid", async ({ page, request }) => {
    await uploadImages(request, 3);
    await page.goto("/");

    await expect(page.getByText("3 images")).toBeVisible();
    await expect(page.locator("main img")).toHaveCount(3);

    // Thumbnails must be served, not broken — a 404 would still render an <img>.
    const loaded = await page
      .locator("main img")
      .first()
      .evaluate((node) => {
        const image = node as HTMLImageElement;
        return image.complete && image.naturalWidth > 0;
      });
    expect(loaded).toBe(true);
  });

  test("switches between flat and mosaic layouts and remembers the choice", async ({
    page,
    request,
  }) => {
    // More images than the widest breakpoint has columns (5), so that a
    // column-first fill would demonstrably put tile 2 underneath tile 1.
    await uploadImages(request, 6);
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

    // The regression this guards: the mosaic used to be CSS multi-column, which
    // fills a whole column before starting the next, so tile 2 rendered *below*
    // tile 1. No class assertion can see that — only geometry can.
    const tiles = page.locator('[data-layout="mosaic"] > div');
    const firstTile = await tiles.nth(0).boundingBox();
    const secondTile = await tiles.nth(1).boundingBox();
    if (!firstTile || !secondTile) throw new Error("mosaic tiles have no layout box");
    expect(secondTile.x).toBeGreaterThan(firstTile.x + firstTile.width / 2);
    expect(Math.abs(secondTile.y - firstTile.y)).toBeLessThan(2);

    // And the mosaic's actual promise: a tile is as tall as its own proportions
    // rather than cropped to the flat grid's uniform 4/5.
    const thumbnail = page.locator('[data-layout="mosaic"] img').first();
    const declared = await thumbnail.evaluate((node) => {
      const image = node as HTMLImageElement;
      return Number(image.getAttribute("height")) / Number(image.getAttribute("width"));
    });
    const thumbnailBox = await thumbnail.boundingBox();
    if (!thumbnailBox) throw new Error("mosaic thumbnail has no layout box");
    expect(thumbnailBox.height / thumbnailBox.width).toBeCloseTo(declared, 1);

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

  // The drop path used to report nothing when a file was rejected: its errors
  // went to a fetcher the Stream never read. They now surface on the progress
  // card, which is the only place an import speaks from.
  test("the progress card names the files that failed", async ({ page }) => {
    await page.goto("/");

    const good = await png(400, 300, [80, 160, 120]);
    // The declared type gets it past the dropzone's image filter; ingest reads
    // the actual bytes and rejects it.
    const bad = Buffer.from("not an image at all");

    await dropFiles(page, [
      { name: "good.png", base64: good.toString("base64") },
      { name: "broken.png", base64: bad.toString("base64") },
    ]);

    const card = page.getByTestId("upload-progress");
    await expect(card).toContainText("1 uploaded, 1 failed");
    await expect(card).toContainText("broken.png");

    await expect(page.locator("main img")).toHaveCount(1);

    await card.getByRole("button", { name: "Dismiss" }).click();
    await expect(card).toBeHidden();
  });
});

test.describe("Detail panel", () => {
  test("opens beside the image and shows an uploaded image has no source", async ({
    page,
    request,
  }) => {
    await uploadImages(request, 1);
    await page.goto("/");
    await openDetails(page);

    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Uploaded — no source page")).toBeVisible();
    // Both params, because the panel is a column inside the viewer rather than
    // a surface that replaces it.
    await expect(page).toHaveURL(/\?.*view=/);
    await expect(page).toHaveURL(/\?.*image=/);
    // No preview of its own at this width — the viewer is already showing it.
    await expect(panel.locator("a[href$='/original'] img")).toBeHidden();
  });

  test("is never opened by the viewer on its own, and its control toggles", async ({
    page,
    request,
  }) => {
    await uploadImages(request, 1);
    await page.goto("/");
    await openViewer(page);

    // Looking is not editing: opening the viewer brings no panel with it.
    await expect(page).not.toHaveURL(/image=/);
    const details = page.getByRole("link", { name: "Details" });
    await expect(details).toHaveAttribute("aria-pressed", "false");

    await details.click();
    await expect(page).toHaveURL(/image=/);
    await expect(details).toHaveAttribute("aria-pressed", "true");

    // The same control closes it again, leaving the viewer up.
    await details.click();
    await expect(page).not.toHaveURL(/image=/);
    await expect(page).toHaveURL(/view=/);
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("follows the viewer when it steps to another image", async ({ page, request }) => {
    await uploadImages(request, 2);
    await page.goto("/");
    const ids = await visibleImageIds(page);
    await openDetails(page);

    await expect(page).toHaveURL(new RegExp(`image=${ids[0]}`));
    await page.keyboard.press("ArrowRight");

    // Both params move together — a panel left on the image you stepped away
    // from would be editing something off screen.
    await expect(page).toHaveURL(new RegExp(`view=${ids[1]}`));
    await expect(page).toHaveURL(new RegExp(`image=${ids[1]}`));
  });

  test("naming an image shows the name everywhere it is rendered", async ({ page, request }) => {
    await uploadImages(request, 1);
    await page.goto("/");
    await openDetails(page);

    const panel = page.getByRole("dialog");
    // An uploaded Image has no source page title to fall back to.
    await expect(panel.getByPlaceholder("Untitled")).toHaveValue("");
    await panel.getByPlaceholder("Untitled").fill("Brutalist stairwell");
    await panel.getByPlaceholder("Untitled").blur();

    // The panel's own heading is the save landing. Waiting on it before moving
    // on matters: the edit saves on blur, so pressing Escape first races the
    // submission against the navigation that closes the viewer.
    await expect(detailsPanel(page).getByRole("heading")).toHaveText("Brutalist stairwell");

    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("link", { name: "Brutalist stairwell", exact: true }),
    ).toBeVisible();

    // And it survives a reload, so it was written rather than only held in state.
    await page.reload();
    await openDetails(page);
    await expect(page.getByRole("dialog").getByPlaceholder("Untitled")).toHaveValue(
      "Brutalist stairwell",
    );
  });

  test("clearing the name falls back to the source page title", async ({
    page,
    request,
    baseURL,
  }) => {
    await captureImage(request, baseURL!, {
      sourcePageTitle: "Concrete Monthly",
      sourcePageUrl: "https://example.invalid/concrete",
    });

    await page.goto("/");
    await openDetails(page);

    const panel = page.getByRole("dialog");
    const name = panel.getByPlaceholder("Concrete Monthly");
    await name.fill("My own name");
    await name.blur();
    await expect(panel.getByText("Falling back to the source page title.")).toBeHidden();

    await name.fill("");
    await name.blur();
    // The captured title stands in again, and was never overwritten.
    await expect(panel.getByText("Falling back to the source page title.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("link", { name: "Concrete Monthly", exact: true })).toBeVisible();
  });

  test("a source page url can be added to an upload and is validated", async ({
    page,
    request,
  }) => {
    await uploadImages(request, 1);
    await page.goto("/");
    await openDetails(page);

    const panel = page.getByRole("dialog");
    const url = panel.getByPlaceholder("https://…");

    // Rejected without a scheme, and the field says so rather than silently
    // dropping the edit.
    await url.fill("example.invalid/not-a-url");
    await url.blur();
    await expect(panel.getByText("Enter an http or https URL.")).toBeVisible();
    // The invalid value was not stored: no link to open appeared.
    await expect(panel.getByRole("link", { name: "Open source page" })).toBeHidden();

    await url.fill("https://example.invalid/found-here");
    await url.blur();
    await expect(panel.getByText("Uploaded — no source page")).toBeHidden();
    await expect(panel.getByRole("link", { name: "Open source page" })).toHaveAttribute(
      "href",
      "https://example.invalid/found-here",
    );
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
    const darkUi = panel.getByRole("checkbox").first();
    await darkUi.click();
    // Same reason as the rename above: wait for the toggle to come back saved
    // rather than racing it against the navigation Escape starts.
    await expect(darkUi).toBeChecked();
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
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /Move to Trash/ })
      .click();

    await expect(page.locator("main img")).toHaveCount(1);

    await page.getByRole("link", { name: /Trash/ }).click();
    await expect(page.getByRole("heading", { name: "Trash" })).toBeVisible();
    await page.locator("main .group").first().hover();
    await page
      .getByRole("button", { name: /Restore/ })
      .first()
      .click();

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
    await expect(viewer.locator("img[data-current]")).toHaveAttribute(
      "src",
      `/img/${ids[0]}/medium`,
    );
    await expect(viewer.getByText("1 / 3")).toBeVisible();
    // The grid is still there underneath, ready for the tile to morph back to.
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

  test("closing it takes the details panel with it", async ({ page, request }) => {
    await uploadImages(request, 1);
    await page.goto("/");
    await openDetails(page);

    // The panel is inside this dialog, so it cannot outlive it — a stray
    // `?image=` would leave the layout loading a selection nothing renders.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page).not.toHaveURL(/view=/);
    await expect(page).not.toHaveURL(/image=/);
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
    // The heading is in the server HTML. The shortcut is not — it is attached
    // in an effect, and a "1" sent before that is ignored.
    await expect(page.locator("html")).toHaveAttribute("data-triage-keys", "true");

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
    await expect(dialog.getByRole("heading", { name: "Import 1 file?" })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Import 2 files?" })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Import and add to board" }).click();

    await expect(page.locator("main img")).toHaveCount(2);
    await page.goto("/");
    await expect(page.locator("main img")).toHaveCount(3);
  });

  test("publishing shows a link to the address the app is served on", async ({ page, request }) => {
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
    await expect(dialog.getByRole("heading", { name: "Import 1 file?" })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Import 2 files?" })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Import and tag" }).click();

    await expect(page.locator("main img")).toHaveCount(3);
    await page.goto("/");
    await expect(page.locator("main img")).toHaveCount(4);
    await expect(page.getByRole("link", { name: /palette/ })).toContainText("3");
  });
});
