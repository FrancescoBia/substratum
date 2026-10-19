import { expect, test } from "@playwright/test";
import { createBoard, detailsPanel, openDetails, uploadFile, uploadImages, video } from "./helpers";

const SHOTS = "screenshots";

/**
 * Not an assertion suite — this exists so reviewing the UI is looking at a
 * folder of PNGs instead of setting up an instance and clicking through it.
 * Run with `pnpm shots`.
 */
test("capture every view", async ({ page, request }) => {
  test.slow();

  // Uploaded first so it sits last in the newest-first Stream: in every grid
  // shot with its duration badge, without becoming the Image the detail-panel
  // shots open.
  await uploadFile(request, {
    name: "motion.webm",
    mimeType: "video/webm",
    buffer: await video("webm", ["-c:v", "libvpx-vp9", "-deadline", "realtime"]),
  });
  await uploadImages(request, 9);
  const darkUi = await createBoard(request, "Dark UI");
  await createBoard(request, "Typography");

  await page.setViewportSize({ width: 1440, height: 900 });

  // A populated Stream, before anything is filed.
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/01-stream-untriaged.png` });

  // The details column open beside the Image in the full-size viewer.
  await openDetails(page);
  const viewer = page.getByRole("dialog");
  const panel = detailsPanel(page);
  await panel.waitFor();
  await panel.getByPlaceholder("Untitled").fill("Stairwell, Barbican");
  await panel.getByPlaceholder("Untitled").blur();
  await panel.getByPlaceholder("https://…").fill("https://example.com/barbican");
  await panel.getByPlaceholder("https://…").blur();
  await panel.getByPlaceholder("Add a tag…").fill("editorial");
  await panel.getByPlaceholder("Add a tag…").press("Enter");
  await panel.getByRole("checkbox").first().click();
  await page.waitForLoadState("networkidle");
  // The sheet slides and the scrim fades — the same settle the full-size shot
  // needs, or this catches a half-drawn panel.
  await expect(panel.getByText("editorial ×")).toBeVisible();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/02-detail-panel.png` });

  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden(); // the overlay animates out — don't shoot through it
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/03-stream-with-sidebar.png` });

  // An image at full size over the Stream. The larger variant is fetched on
  // open and the scrim fades in, so wait for both rather than shooting through
  // a half-drawn overlay.
  await page.locator("main a").first().click();
  await viewer.waitFor();
  await viewer.locator("img[data-current]").evaluate((node) => (node as HTMLImageElement).decode());
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/09-full-size.png` });
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();

  // The same details column on a phone, where there is no room beside the Image
  // so the panel covers it and brings its own preview.
  await page.setViewportSize({ width: 390, height: 844 });
  await openDetails(page);
  await expect(panel.locator("img")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/10-detail-panel-mobile.png` });
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });

  // Triage mode mid-queue.
  await page.goto("/triage");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/04-triage.png` });

  // A board view, published so the slug notice shows.
  const published = await request.post("/boards", {
    form: { intent: "publish", boardId: darkUi },
  });
  const { slug } = (await published.json()) as { slug: string };
  await page.goto(`/boards/${darkUi}`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/05-board-published.png` });

  // The public page as a stranger sees it: no sidebar, no tags, no notes.
  await page.goto(`/board/${slug}`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/08-public-board.png`, fullPage: true });

  // Trash with one item in it.
  await page.goto("/");
  await openDetails(page, 1);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Move to Trash/ })
    .click();
  await page.goto("/trash");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/06-trash.png` });

  // Dark mode, since the theme is meant to work both ways.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/07-stream-dark.png` });
});
