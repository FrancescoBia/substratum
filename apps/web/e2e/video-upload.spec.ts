import { readdir } from "node:fs/promises";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { MAX_VIDEO_BYTES } from "@repo/shared";
import { unzipSync } from "fflate";
import sharp from "sharp";
import {
  createBoard,
  dropFiles,
  hydrated,
  mp4,
  portraitMp4,
  resetLibrary,
  uploadFile,
  video,
} from "./helpers";
import type { Manifest } from "~/lib/export.server";

/**
 * Videos come in through the same upload as images, and are told apart by
 * their bytes. What ingest recorded is read back from the export manifest —
 * the one place every stored field is spelled out.
 */

test.beforeEach(async ({ request }) => {
  await resetLibrary(request);
});

async function manifest(request: APIRequestContext): Promise<Manifest> {
  const files = unzipSync(new Uint8Array(await (await request.get("/export")).body()));
  return JSON.parse(new TextDecoder().decode(files["manifest.json"])) as Manifest;
}

/** Nothing an upload spooled outlives its request, kept or refused. */
async function expectSpoolEmpty() {
  const left = await readdir(".playwright-data/tmp").catch(() => []);
  expect(left).toEqual([]);
}

test("MP4, MOV and WebM are each stored as a video", async ({ request }) => {
  const clips = [
    { name: "clip.mp4", mimeType: "video/mp4", buffer: await mp4() },
    {
      name: "clip.mov",
      mimeType: "video/quicktime",
      buffer: await video("mov", ["-c:v", "libx264", "-pix_fmt", "yuv420p"]),
    },
    {
      name: "clip.webm",
      mimeType: "video/webm",
      buffer: await video("webm", ["-c:v", "libvpx-vp9", "-deadline", "realtime"]),
    },
  ];

  for (const clip of clips) {
    expect(await uploadFile(request, clip)).toEqual({ uploaded: 1, errors: [] });
  }

  const { images } = await manifest(request);
  expect(images.map((image) => image.format).sort()).toEqual(["mov", "mp4", "webm"]);
  for (const image of images) {
    expect(image.kind).toBe("video");
    expect([image.width, image.height]).toEqual([320, 240]);
    expect(Math.abs((image.durationMs ?? 0) - 2000)).toBeLessThan(100);
    expect(image.file).toMatch(new RegExp(`\\.${image.format}$`));
  }
  await expectSpoolEmpty();
});

test("a video's original plays from a range, and its poster is a still", async ({ request }) => {
  await uploadFile(request, { name: "clip.mp4", mimeType: "video/mp4", buffer: await mp4() });
  const [{ id }] = (await manifest(request)).images;

  const original = await request.get(`/img/${id}/original`, { headers: { Range: "bytes=0-99" } });
  expect(original.status()).toBe(206);
  expect(original.headers()["content-type"]).toBe("video/mp4");

  const thumb = await request.get(`/img/${id}/thumb`);
  expect(thumb.headers()["content-type"]).toBe("image/webp");
  expect((await sharp(await thumb.body()).metadata()).width).toBe(320);
});

test("a phone-style rotated video is stored at the size it is shown", async ({ request }) => {
  const buffer = await portraitMp4();
  const result = await uploadFile(request, { name: "portrait.mp4", mimeType: "video/mp4", buffer });
  expect(result).toEqual({ uploaded: 1, errors: [] });

  const [image] = (await manifest(request)).images;
  expect([image.width, image.height]).toEqual([240, 320]);

  // The poster is turned too, so the tile matches what plays.
  const poster = await sharp(await (await request.get(`/img/${image.id}/thumb`)).body()).metadata();
  expect([poster.width, poster.height]).toEqual([240, 320]);
});

test("HEVC is refused, saying how to fix it", async ({ request }) => {
  const buffer = await video("mp4", [
    "-c:v",
    "libx265",
    "-x265-params",
    "log-level=none",
    "-tag:v",
    "hvc1",
  ]);

  const result = await uploadFile(request, { name: "iphone.mp4", mimeType: "video/mp4", buffer });

  expect(result.uploaded).toBe(0);
  expect(result.errors[0]).toMatch(/^iphone\.mp4: That video is HEVC/);
  expect(result.errors[0]).toMatch(/export it as H\.264/);
  expect((await manifest(request)).images).toHaveLength(0);
  await expectSpoolEmpty();
});

test("an MKV is refused by name", async ({ request }) => {
  const buffer = await video("mkv", ["-c:v", "libvpx-vp9", "-deadline", "realtime"]);

  const result = await uploadFile(request, {
    name: "clip.mkv",
    mimeType: "video/x-matroska",
    buffer,
  });

  expect(result.errors).toEqual([
    "clip.mkv: MKV videos aren't supported — export it as MP4 or WebM to save it.",
  ]);
});

test("a file over the video cap is refused, and nothing of it is kept", async ({ request }) => {
  // A real MP4 header on a body one byte too long: it is read to the end and
  // turned away on size, not cut off mid-request.
  const header = (await mp4()).subarray(0, 64);
  const buffer = Buffer.concat([header, Buffer.alloc(MAX_VIDEO_BYTES + 1 - header.byteLength)]);

  const result = await uploadFile(request, { name: "huge.mp4", mimeType: "video/mp4", buffer });

  expect(result).toEqual({ uploaded: 0, errors: ["huge.mp4: That video is larger than 95 MB."] });
  expect((await manifest(request)).images).toHaveLength(0);
  await expectSpoolEmpty();
});

test("a video uploaded onto a board lands on it", async ({ request }) => {
  const boardId = await createBoard(request, "motion");

  await uploadFile(
    request,
    { name: "clip.mp4", mimeType: "video/mp4", buffer: await mp4() },
    { boardId },
  );

  const [image] = (await manifest(request)).images;
  expect(image.boards).toEqual(["motion"]);
});

test("dropping a video on the page uploads it", async ({ page }) => {
  await page.goto("/");

  const buffer = await mp4();
  await dropFiles(page, [
    { name: "dropped.mp4", base64: buffer.toString("base64"), type: "video/mp4" },
  ]);

  const card = page.getByTestId("upload-progress");
  await expect(card).toContainText("1 uploaded");
  await expect(page.locator("main img")).toHaveCount(1);
});

test("a video too large for the cap is refused before it is sent", async ({ page }) => {
  await page.goto("/");
  await hydrated(page);

  // Built in the page: only the declared size matters, and nothing is posted.
  let posted = false;
  page.on("request", (request) => {
    if (request.url().endsWith("/upload")) posted = true;
  });

  await page.evaluate((size) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(size)], "huge.mov", { type: "video/quicktime" }));
    window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: transfer }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, cancelable: true }));
  }, MAX_VIDEO_BYTES + 1);

  const card = page.getByTestId("upload-progress");
  await expect(card).toContainText("huge.mov: That video is larger than 95 MB.");
  expect(posted).toBe(false);
});

test("a slow upload shows its bytes going up, then processing, then the result", async ({
  page,
}) => {
  await page.goto("/");
  await hydrated(page);

  // Every heading the card shows, in order — "Processing…" lasts well under a
  // second, too briefly for polling to be sure of catching it.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as { __headings?: string[] }).__headings = seen;
    new MutationObserver(() => {
      const heading = document.querySelector("[data-testid=upload-progress] p")?.textContent;
      if (heading && seen.at(-1) !== heading) seen.push(heading);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });

  // About 4 MB at 1 MB/s: long enough to watch the bar move.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: 1024 * 1024,
  });

  const buffer = await video("mp4", [
    "-t",
    "1",
    "-vf",
    "scale=640:360,noise=alls=60:allf=t",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "14",
    "-pix_fmt",
    "yuv420p",
  ]);
  await page
    .locator("input[type=file]")
    .setInputFiles({ name: "slow.mp4", mimeType: "video/mp4", buffer });

  const bar = page.getByTestId("upload-progress").getByRole("progressbar");
  await expect
    .poll(async () => Number((await bar.getAttribute("aria-valuenow")) ?? 0))
    .toBeGreaterThan(0);
  expect(Number(await bar.getAttribute("aria-valuenow"))).toBeLessThan(100);

  await expect(page.getByTestId("upload-progress")).toContainText("1 uploaded", {
    timeout: 30_000,
  });
  const headings = await page.evaluate(() => (window as { __headings?: string[] }).__headings);
  expect(headings).toEqual(["Uploading…", "Processing…", "1 uploaded"]);
});
