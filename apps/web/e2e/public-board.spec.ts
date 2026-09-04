import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { createBoard, resetLibrary, uploadImages } from "./helpers";

test.beforeEach(async ({ request }) => {
  await resetLibrary(request);
});

/**
 * A browser with no session at all.
 *
 * Note this is a *separate context* rather than `test.use({ storageState })`:
 * that clears state for the whole test, including the `request` fixture used to
 * set the board up, which would leave the setup calls unauthenticated.
 */
async function asStranger<T>(browser: Browser, body: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    return await body(await context.newPage());
  } finally {
    await context.close();
  }
}

/** Image ids as the Owner sees them, read from the Stream's markup. */
async function imageIds(request: APIRequestContext): Promise<string[]> {
  const html = await (await request.get("/")).text();
  return [...new Set([...html.matchAll(/\/img\/([0-9a-f-]{36})\//g)].map((match) => match[1]))];
}

async function publishBoard(request: APIRequestContext, name: string, imageCount: number) {
  await uploadImages(request, imageCount);
  const boardId = await createBoard(request, name);

  const ids = await imageIds(request);
  for (const id of ids) {
    await request.post(`/image/${id}`, { form: { intent: "toggle-board", boardId } });
  }

  const response = await request.post("/boards", { form: { intent: "publish", boardId } });
  const { slug } = (await response.json()) as { slug: string };
  return { boardId, slug, ids };
}

test("a published board is readable with no session at all", async ({ browser, request }) => {
  const { slug } = await publishBoard(request, "Dark UI", 3);

  await asStranger(browser, async (page) => {
    // Sanity check that this really is anonymous.
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);

    await page.goto(`/board/${slug}`);
    await expect(page.getByRole("heading", { name: "Dark UI" })).toBeVisible();
    await expect(page.locator("main img")).toHaveCount(3);

    // The images have to actually load — a 404 still renders an <img>.
    const loaded = await page.locator("main img").first().evaluate((node) => {
      const image = node as HTMLImageElement;
      return image.complete && image.naturalWidth > 0;
    });
    expect(loaded).toBe(true);
  });
});

test("a visitor can open an image at full size", async ({ browser, request }) => {
  const { slug, ids } = await publishBoard(request, "Dark UI", 2);

  await asStranger(browser, async (page) => {
    await page.goto(`/board/${slug}`);
    await page.locator("main a").first().click();

    const viewer = page.getByRole("dialog");
    await expect(viewer).toBeVisible();

    const source = await viewer.locator("img").getAttribute("src");
    expect(ids).toContain(source?.match(/\/img\/([^/]+)\//)?.[1]);

    // The larger variant has to be served to a stranger too, not just the
    // thumbnail the tile uses — a 404 would still render an <img>.
    const loaded = await viewer.locator("img").evaluate((node) => {
      const image = node as HTMLImageElement;
      return image.complete && image.naturalWidth > 0;
    });
    expect(loaded).toBe(true);

    await page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();
  });
});

test("the shareable URL follows the address the page was served on", async ({
  browser,
  request,
}) => {
  const { slug } = await publishBoard(request, "Dark UI", 1);

  await asStranger(browser, async (page) => {
    await page.goto(`/board/${slug}`);

    // This instance sets no SUBSTRATUM_URL, so the origin is read off the
    // request rather than guessed from the port the process happens to bind.
    const origin = new URL(page.url()).origin;
    const ogUrl = page.locator('meta[property="og:url"]');
    await expect(ogUrl).toHaveAttribute("content", `${origin}/board/${slug}`);

    // A TLS-terminating proxy is the case SUBSTRATUM_URL exists for, but what
    // the proxy says it forwarded still beats the internal address.
    await page.setExtraHTTPHeaders({
      "X-Forwarded-Proto": "https",
      "X-Forwarded-Host": "boards.example.com",
    });
    await page.reload();
    await expect(ogUrl).toHaveAttribute(
      "content",
      `https://boards.example.com/board/${slug}`,
    );
  });
});

test("unpublishing takes the page down", async ({ browser, request }) => {
  const { slug, boardId } = await publishBoard(request, "Private Thoughts", 1);
  await request.post("/boards", { form: { intent: "unpublish", boardId } });

  await asStranger(browser, async (page) => {
    const response = await page.goto(`/board/${slug}`);
    expect(response?.status()).toBe(404);
  });
});

test("a slug that was never published 404s", async ({ browser }) => {
  await asStranger(browser, async (page) => {
    const response = await page.goto("/board/no-such-board");
    expect(response?.status()).toBe(404);
  });
});

test("tags and notes never appear on the public page", async ({ browser, request }) => {
  const { slug, ids } = await publishBoard(request, "Typography", 1);

  await request.post(`/image/${ids[0]}`, { form: { intent: "add-tag", tag: "secret-tag" } });
  await request.post(`/image/${ids[0]}`, {
    form: { intent: "set-note", note: "my private thoughts" },
  });

  await asStranger(browser, async (page) => {
    await page.goto(`/board/${slug}`);
    await expect(page.getByRole("heading", { name: "Typography" })).toBeVisible();
    await expect(page.getByText("secret-tag")).toBeHidden();
    await expect(page.getByText("my private thoughts")).toBeHidden();
    // Nor any of the library's own furniture.
    await expect(page.getByRole("link", { name: /^Stream/ })).toBeHidden();
  });
});

test("trashing an image removes it from the public page immediately", async ({
  browser,
  request,
}) => {
  const { slug, ids } = await publishBoard(request, "Layout", 2);

  await asStranger(browser, async (page) => {
    await page.goto(`/board/${slug}`);
    await expect(page.locator("main img")).toHaveCount(2);

    await request.post(`/image/${ids[0]}`, { form: { intent: "trash" } });

    await page.reload();
    await expect(page.locator("main img")).toHaveCount(1);

    // And its bytes stop being served, not merely its tile.
    const image = await page.request.get(`/img/${ids[0]}/thumb`);
    expect(image.status()).toBe(404);
  });
});

test("images not on any published board are never served anonymously", async ({
  browser,
  request,
}) => {
  await uploadImages(request, 1);
  const [id] = await imageIds(request);
  expect(id).toBeTruthy();

  await asStranger(browser, async (page) => {
    const response = await page.request.get(`/img/${id}/thumb`);
    expect(response.status()).toBe(404);
  });
});

test("robots.txt allows boards and disallows the rest", async ({ browser }) => {
  await asStranger(browser, async (page) => {
    const response = await page.request.get("/robots.txt");
    expect(response.status()).toBe(200);

    const body = await response.text();
    expect(body).toContain("Allow: /board/");
    expect(body).toContain("Disallow: /");
  });
});
