import { expect, test } from "@playwright/test";
import { createBoard, uploadImages } from "./helpers";

const SHOTS = "screenshots";

/**
 * Not an assertion suite — this exists so reviewing the UI is looking at a
 * folder of PNGs instead of setting up an instance and clicking through it.
 * Run with `pnpm shots`.
 */
test("capture every view", async ({ page, request }) => {
  test.slow();

  await uploadImages(request, 9);
  const darkUi = await createBoard(request, "Dark UI");
  await createBoard(request, "Typography");

  await page.setViewportSize({ width: 1440, height: 900 });

  // A populated Stream, before anything is filed.
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/01-stream-untriaged.png` });

  // Detail panel open over the grid.
  await page.locator("main a").first().click();
  const panel = page.getByRole("dialog");
  await panel.waitFor();
  await panel.getByPlaceholder("Add a tag…").fill("editorial");
  await panel.getByPlaceholder("Add a tag…").press("Enter");
  await panel.getByRole("checkbox").first().click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/02-detail-panel.png` });

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden(); // the overlay animates out — don't shoot through it
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/03-stream-with-sidebar.png` });

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
  await page.locator("main a").nth(1).click();
  await page.getByRole("dialog").getByRole("button", { name: /Move to Trash/ }).click();
  await page.goto("/trash");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/06-trash.png` });

  // Dark mode, since the theme is meant to work both ways.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/07-stream-dark.png` });
});
