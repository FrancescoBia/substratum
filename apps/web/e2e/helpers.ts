import type { APIRequestContext, Page } from "@playwright/test";
import sharp from "sharp";

/** Credentials for the throwaway test instance only. */
export const OWNER = {
  email: "owner@test.invalid",
  password: "playwright-test-password",
};

export const STORAGE_STATE = "e2e/.auth/owner.json";

/** Solid-colour PNGs, generated rather than committed as binary fixtures. */
export function png(width: number, height: number, rgb: [number, number, number]) {
  return sharp({
    create: { width, height, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } },
  })
    .png()
    .toBuffer();
}

const PALETTE: Array<[number, number, number]> = [
  [214, 69, 65],
  [48, 110, 180],
  [240, 196, 74],
  [76, 164, 109],
  [150, 96, 190],
  [230, 130, 60],
];

/**
 * Uploads through the app's own endpoint, one request per file — the multipart
 * helper can't express repeated field names.
 */
export async function uploadImages(request: APIRequestContext, count: number) {
  for (let index = 0; index < count; index++) {
    const buffer = await png(
      600 + (index % 3) * 100,
      500 + (index % 4) * 120,
      PALETTE[index % PALETTE.length],
    );
    const response = await request.post("/upload", {
      multipart: {
        files: { name: `test-${index}.png`, mimeType: "image/png", buffer },
      },
    });
    if (!response.ok()) {
      throw new Error(`upload failed: ${response.status()} ${await response.text()}`);
    }
  }
}

export async function createBoard(request: APIRequestContext, name: string) {
  const response = await request.post("/boards", { form: { intent: "create", name } });
  const body = (await response.json()) as { ok: boolean; id?: string };
  if (!body.ok || !body.id) throw new Error(`could not create board ${name}`);
  return body.id;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function idsIn(html: string, pattern: string): string[] {
  return [...new Set([...html.matchAll(new RegExp(pattern, "g"))].map((match) => match[1]))];
}

/**
 * Empties the library between tests so each one starts from a known state.
 *
 * Uses only the endpoints the app already has — ids are read back from the pages
 * it renders — rather than a test-only reset route, which would mean shipping a
 * "delete everything" endpoint in a self-hostable app.
 */
export async function resetLibrary(request: APIRequestContext) {
  for (const path of ["/", "/trash"]) {
    const html = await (await request.get(path)).text();
    for (const id of idsIn(html, `/img/(${UUID})/`)) {
      await request.post(`/image/${id}`, { form: { intent: "purge" } });
    }
  }

  const html = await (await request.get("/")).text();
  for (const id of idsIn(html, `/boards/(${UUID})`)) {
    await request.post("/boards", {
      form: { intent: "delete", boardId: id },
      maxRedirects: 0,
    });
  }
}

/**
 * Opens an Image's detail panel. The tile itself now opens the full-size viewer,
 * so the panel is reached through the corner control that appears on hover.
 */
export async function openDetails(page: Page, nth = 0) {
  const link = page.getByRole("link", { name: /^Details for/ }).nth(nth);
  await link.hover();
  await link.click();
}

/** Ids of live Images, newest first — read from the page the app renders. */
export async function visibleImageIds(page: Page): Promise<string[]> {
  return page.locator("main img").evaluateAll((nodes) =>
    nodes
      .map((node) => (node as HTMLImageElement).getAttribute("src") ?? "")
      .map((src) => src.match(/\/img\/([^/]+)\//)?.[1] ?? "")
      .filter(Boolean),
  );
}

/**
 * Drops files on the window the way a real drag does. Playwright can't drive the
 * OS file dialog, so the DataTransfer is built in the page and dispatched — this
 * is the only way to exercise the window-level drop handler.
 */
export async function dropFiles(page: Page, files: Array<{ name: string; base64: string }>) {
  const handle = await page.evaluateHandle((items) => {
    const transfer = new DataTransfer();
    for (const item of items) {
      const binary = atob(item.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      transfer.items.add(new File([bytes], item.name, { type: "image/png" }));
    }
    return transfer;
  }, files);

  await page.dispatchEvent("body", "dragenter", { dataTransfer: handle });
  await page.dispatchEvent("body", "drop", { dataTransfer: handle });
}
