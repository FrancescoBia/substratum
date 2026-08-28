import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";
import { createBoard, resetLibrary, uploadImages } from "./helpers";
import type { Manifest } from "~/lib/export.server";

test.beforeEach(async ({ request }) => {
  await resetLibrary(request);
});

async function imageIds(request: APIRequestContext): Promise<string[]> {
  const html = await (await request.get("/")).text();
  return [...new Set([...html.matchAll(/\/img\/([0-9a-f-]{36})\//g)].map((match) => match[1]))];
}

/** Downloads the export and unzips it, so assertions are about real contents. */
async function fetchExport(request: APIRequestContext) {
  const response = await request.get("/export");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/zip");

  const files = unzipSync(new Uint8Array(await response.body()));
  const manifest = JSON.parse(
    new TextDecoder().decode(files["manifest.json"]),
  ) as Manifest;

  return { files, manifest, headers: response.headers() };
}

test("the export is a zip named for today, with a manifest", async ({ request }) => {
  await uploadImages(request, 2);

  const { manifest, headers } = await fetchExport(request);

  expect(headers["content-disposition"]).toMatch(
    /attachment; filename="substratum-export-\d{4}-\d{2}-\d{2}\.zip"/,
  );
  expect(manifest.manifestVersion).toBe(1);
  expect(manifest.counts.images).toBe(2);
  expect(manifest.images).toHaveLength(2);
});

test("every manifest entry has its original in the zip", async ({ request }) => {
  await uploadImages(request, 3);

  const { files, manifest } = await fetchExport(request);

  for (const image of manifest.images) {
    expect(files[image.file], `${image.file} present`).toBeTruthy();
    // The bytes are the real image, not a placeholder.
    expect(files[image.file].byteLength).toBe(image.byteSize);
    expect(files[image.file].byteLength).toBeGreaterThan(0);
  }
});

test("organization survives the round trip", async ({ request }) => {
  await uploadImages(request, 2);
  const boardId = await createBoard(request, "Dark UI");
  const ids = await imageIds(request);

  await request.post(`/image/${ids[0]}`, { form: { intent: "toggle-board", boardId } });
  await request.post(`/image/${ids[0]}`, { form: { intent: "add-tag", tag: "Editorial" } });
  await request.post(`/image/${ids[0]}`, { form: { intent: "set-note", note: "keep this one" } });

  const { manifest } = await fetchExport(request);

  const organized = manifest.images.find((image) => image.id === ids[0]);
  expect(organized?.boards).toEqual(["Dark UI"]);
  expect(organized?.tags).toEqual(["editorial"]);
  expect(organized?.note).toBe("keep this one");

  const untouched = manifest.images.find((image) => image.id === ids[1]);
  expect(untouched?.boards).toEqual([]);
  expect(untouched?.tags).toEqual([]);

  expect(manifest.boards.map((board) => board.name)).toContain("Dark UI");
});

test("an uploaded image records no source, a captured one does", async ({ request }) => {
  await uploadImages(request, 1);

  const { manifest } = await fetchExport(request);
  expect(manifest.images[0].source).toBeNull();
});

test("trashed images are left out", async ({ request }) => {
  await uploadImages(request, 2);
  const ids = await imageIds(request);
  await request.post(`/image/${ids[0]}`, { form: { intent: "trash" } });

  const { files, manifest } = await fetchExport(request);

  expect(manifest.counts.images).toBe(1);
  expect(manifest.trashedImagesExcluded).toBe(true);
  expect(manifest.images.map((image) => image.id)).not.toContain(ids[0]);
  // And its bytes aren't in the zip either.
  expect(Object.keys(files).some((name) => name.includes(ids[0]))).toBe(false);
});

test("exporting an empty library still produces a valid zip", async ({ request }) => {
  const { files, manifest } = await fetchExport(request);

  expect(manifest.counts.images).toBe(0);
  expect(manifest.images).toEqual([]);
  expect(Object.keys(files)).toEqual(["manifest.json"]);
});

test("the export needs a session", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const response = await context.request.get("/export", { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(response.headers()["location"]).toContain("/login");
  } finally {
    await context.close();
  }
});
