import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { createBoard, png, resetLibrary, uploadFile, video } from "./helpers";

/**
 * How videos show up once stored: marked in every grid, playing on hover, and
 * playing in the viewer — for the Owner and for a visitor to a published board.
 *
 * Clips here are VP9 WebM: Playwright's Chromium is built without the
 * proprietary H.264 decoder, so an MP4 would load but never play.
 */

test.beforeEach(async ({ request }) => {
  await resetLibrary(request);
});

function webm() {
  return video("webm", ["-c:v", "libvpx-vp9", "-deadline", "realtime"]);
}

async function uploadVideo(request: APIRequestContext, name = "clip.webm") {
  await uploadFile(request, { name, mimeType: "video/webm", buffer: await webm() });
}

/** Ids whose original was requested — the clip itself, not its poster. */
function watchOriginals(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    const id = request.url().match(/\/img\/([^/]+)\/original/)?.[1];
    if (id) seen.push(id);
  });
  return seen;
}

function isPlaying(page: Page) {
  return page
    .locator("main video")
    .evaluate((node: HTMLVideoElement) => !node.paused && node.currentTime > 0);
}

test("a video tile says it is one, and how long it runs", async ({ page, request }) => {
  await uploadVideo(request);
  await uploadFile(request, {
    name: "still.png",
    mimeType: "image/png",
    buffer: await png(400, 300, [40, 90, 160]),
  });

  await page.goto("/");

  await expect(page.getByText("1 image, 1 video")).toBeVisible();
  await expect(page.locator("main a").filter({ hasText: "0:02" })).toHaveCount(1);
});

test("hovering a tile plays it, leaving stops it, and nothing else is fetched", async ({
  page,
  request,
}) => {
  await uploadVideo(request, "first.webm");
  await uploadVideo(request, "second.webm");
  const originals = watchOriginals(page);

  await page.goto("/");
  await expect(page.locator("main img")).toHaveCount(2);
  // A grid of videos costs its posters, and nothing more, until a hover.
  expect(originals).toEqual([]);

  const tile = page.locator("main a[href*='view=']").first();
  await tile.hover();
  await expect(page.locator("main video")).toHaveCount(1);
  await expect.poll(() => isPlaying(page)).toBe(true);
  expect(new Set(originals).size).toBe(1);

  await page.mouse.move(0, 0);
  await expect(page.locator("main video")).toHaveCount(0);
});

test("a reader who asked for less motion keeps the poster", async ({ page, request }) => {
  await uploadVideo(request);
  await page.emulateMedia({ reducedMotion: "reduce" });

  await page.goto("/");
  await page.locator("main a[href*='view=']").first().hover();

  // Give a hover every chance to have started something.
  await page.waitForTimeout(500);
  await expect(page.locator("main video")).toHaveCount(0);
});

test("the viewer plays a video muted and looping, with controls", async ({ page, request }) => {
  await uploadVideo(request);

  await page.goto("/");
  await page.locator("main a[href*='view=']").first().click();

  const player = page.getByRole("dialog").locator("video");
  await expect(player).toBeVisible();
  const state = await player.evaluate((node: HTMLVideoElement) => ({
    muted: node.muted,
    loop: node.loop,
    controls: node.controls,
    poster: node.getAttribute("poster"),
  }));
  expect(state).toMatchObject({ muted: true, loop: true, controls: true });
  expect(state.poster).toMatch(/\/medium$/);
  await expect
    .poll(() => player.evaluate((node: HTMLVideoElement) => node.currentTime > 0))
    .toBe(true);

  // Never an original in an <img>: that is a video file, not a picture.
  await expect(page.getByRole("dialog").locator("img[srcset*='original']")).toHaveCount(0);
});

test("a visitor to a published board sees videos play", async ({ browser, request }) => {
  await uploadVideo(request);
  const html = await (await request.get("/")).text();
  const id = html.match(/\/img\/([0-9a-f-]{36})\//)?.[1];
  if (!id) throw new Error("could not find the uploaded video");

  const boardId = await createBoard(request, "motion");
  await request.post(`/image/${id}`, { form: { intent: "toggle-board", boardId } });
  const { slug } = (await (
    await request.post("/boards", { form: { intent: "publish", boardId } })
  ).json()) as { slug: string };

  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    await page.goto(`/board/${slug}`);

    await expect(page.getByText("1 video", { exact: true })).toBeVisible();
    await expect(page.locator("main a").filter({ hasText: "0:02" })).toHaveCount(1);

    await page.locator("main a[href*='view=']").hover();
    await expect.poll(() => isPlaying(page)).toBe(true);

    await page.locator("main a[href*='view=']").click();
    await expect(page.getByRole("dialog").locator("video")).toBeVisible();
  } finally {
    await context.close();
  }
});
