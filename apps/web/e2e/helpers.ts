import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import sharp from "sharp";
import type { UploadResult } from "~/routes/upload";

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

const ffmpeg = (args: string[]) =>
  promisify(execFile)(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", ...args]);

/**
 * A two-second clip of ffmpeg's test pattern at 320×240, encoded however `args`
 * says — made fresh rather than committed, like the PNGs.
 */
export async function video(extension: string, args: string[]): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "substratum-e2e-"));
  try {
    const path = join(dir, `clip.${extension}`);
    await ffmpeg(["-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=2", ...args, path]);
    return await readFile(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** H.264 in an MP4 — the everyday case. */
export function mp4() {
  return video("mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p"]);
}

/**
 * The same MP4 stored the way a phone stores portrait footage: landscape
 * frames, plus an instruction to show them turned a quarter.
 */
export async function portraitMp4(): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "substratum-e2e-"));
  try {
    const [input, output] = [join(dir, "in.mp4"), join(dir, "out.mp4")];
    await writeFile(input, await mp4());
    await ffmpeg(["-display_rotation", "90", "-i", input, "-c", "copy", output]);
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Posts one file to the upload endpoint and hands back what it said. */
export async function uploadFile(
  request: APIRequestContext,
  file: { name: string; mimeType: string; buffer: Buffer },
  fields: Record<string, string> = {},
): Promise<UploadResult> {
  const response = await request.post("/upload", { multipart: { files: file, ...fields } });
  expect(response.ok()).toBe(true);
  return (await response.json()) as UploadResult;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function idsIn(html: string, pattern: string): string[] {
  return [...new Set([...html.matchAll(new RegExp(pattern, "g"))].map((match) => match[1]))];
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

/**
 * Creates an Image with full provenance, the way the extension does.
 *
 * `/api/capture` takes URLs and fetches the bytes itself, so it needs a real
 * http source. The trick is to point it at an image this same instance already
 * serves: a throwaway upload is published on a throwaway Board just long enough
 * to be publicly fetchable, then both are removed. Nothing test-only is added to
 * the app for this.
 */
export async function captureImage(
  request: APIRequestContext,
  baseUrl: string,
  source: { sourcePageUrl: string; sourcePageTitle: string },
) {
  await uploadImages(request, 1);
  const html = await (await request.get("/")).text();
  const seedId = idsIn(html, `/img/(${UUID})/`)[0];
  if (!seedId) throw new Error("could not find the seed image");

  const boardId = await createBoard(request, "capture-source");
  await request.post(`/image/${seedId}`, { form: { intent: "toggle-board", boardId } });
  await request.post("/boards", { form: { intent: "publish", boardId }, maxRedirects: 0 });

  const response = await request.post("/api/capture", {
    form: {
      sourceImageUrl: `${baseUrl}/img/${seedId}/original`,
      sourcePageUrl: source.sourcePageUrl,
      sourcePageTitle: source.sourcePageTitle,
    },
  });
  const body = (await response.json()) as { ok: boolean; message?: string };
  if (!body.ok) throw new Error(`capture failed: ${body.message}`);

  await request.post(`/image/${seedId}`, { form: { intent: "purge" } });
  await request.post("/boards", { form: { intent: "delete", boardId }, maxRedirects: 0 });
}

export async function createBoard(request: APIRequestContext, name: string) {
  const response = await request.post("/boards", { form: { intent: "create", name } });
  const body = (await response.json()) as { ok: boolean; id?: string };
  if (!body.ok || !body.id) throw new Error(`could not create board ${name}`);
  return body.id;
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
 * Opens an Image's detail panel, which now lives inside the full-size viewer:
 * the tile opens the viewer, and its Details control turns the panel on beside
 * the Image. There is no way to the panel from the grid any more.
 */
export async function openDetails(page: Page, nth = 0) {
  await openViewer(page, nth);
  await page.getByRole("link", { name: "Details" }).click();
  await expect(detailsPanel(page)).toBeVisible();
}

/**
 * The details column itself. The viewer's own title is an `h2` too, so anything
 * addressing the panel's heading has to be scoped to this rather than to the
 * whole dialog.
 */
export function detailsPanel(page: Page) {
  return page.getByRole("complementary", { name: "Image details" });
}

/** Opens the full-size viewer on the nth tile, with no details panel. */
export async function openViewer(page: Page, nth = 0) {
  await page.locator("main a[href*='view=']").nth(nth).click();
  await expect(page.getByRole("dialog")).toBeVisible();
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
export async function dropFiles(
  page: Page,
  files: Array<{ name: string; base64: string; type?: string }>,
) {
  const handle = await page.evaluateHandle((items) => {
    const transfer = new DataTransfer();
    for (const item of items) {
      const binary = atob(item.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      transfer.items.add(new File([bytes], item.name, { type: item.type ?? "image/png" }));
    }
    return transfer;
  }, files);

  await page.dispatchEvent("body", "dragenter", { dataTransfer: handle });
  await page.dispatchEvent("body", "drop", { dataTransfer: handle });
}
