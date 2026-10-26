import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { createBoard, resetLibrary, uploadImages } from "./helpers";

/**
 * `/img/:id/original` answers byte ranges, because that is how a browser plays
 * and seeks a video — Safari will not play one at all without them. Images go
 * through the same path, so a PNG stands in here for any original.
 */

test.beforeEach(async ({ request }) => {
  await resetLibrary(request);
});

async function onlyImageId(request: APIRequestContext): Promise<string> {
  await uploadImages(request, 1);
  const html = await (await request.get("/")).text();
  const id = html.match(/\/img\/([0-9a-f-]{36})\//)?.[1];
  if (!id) throw new Error("could not find the uploaded image");
  return id;
}

test("the whole original says it can be asked for in pieces", async ({ request }) => {
  const id = await onlyImageId(request);

  const response = await request.get(`/img/${id}/original`);
  expect(response.status()).toBe(200);
  expect(response.headers()["accept-ranges"]).toBe("bytes");
  expect(response.headers()["content-type"]).toBe("image/png");

  const body = await response.body();
  expect(Number(response.headers()["content-length"])).toBe(body.byteLength);
  // The PNG signature: the bytes are the original's, not a derivative's.
  expect(body.subarray(1, 4).toString("ascii")).toBe("PNG");
});

test("a served file is named for the file that was uploaded", async ({ request }) => {
  const id = await onlyImageId(request);

  // What "Save Image As…" and a drag to the desktop call it — not `original`.
  for (const [variant, name] of [
    ["original", "test-0.png"],
    ["medium", "test-0.webp"],
  ]) {
    const response = await request.get(`/img/${id}/${variant}`);
    expect(response.headers()["content-disposition"]).toBe(
      `inline; filename="${name}"; filename*=UTF-8''${name}`,
    );
  }
});

test("a range comes back as exactly those bytes", async ({ request }) => {
  const id = await onlyImageId(request);
  const whole = await (await request.get(`/img/${id}/original`)).body();

  const response = await request.get(`/img/${id}/original`, {
    headers: { Range: "bytes=4-19" },
  });

  expect(response.status()).toBe(206);
  expect(response.headers()["content-range"]).toBe(`bytes 4-19/${whole.byteLength}`);
  expect(response.headers()["content-length"]).toBe("16");
  expect(await response.body()).toEqual(whole.subarray(4, 20));

  // The open-ended and from-the-end forms browsers also send.
  const tail = await request.get(`/img/${id}/original`, { headers: { Range: "bytes=-8" } });
  expect(tail.status()).toBe(206);
  expect(await tail.body()).toEqual(whole.subarray(whole.byteLength - 8));
});

test("a range past the end is refused with the real size", async ({ request }) => {
  const id = await onlyImageId(request);
  const whole = await (await request.get(`/img/${id}/original`)).body();

  const response = await request.get(`/img/${id}/original`, {
    headers: { Range: `bytes=${whole.byteLength}-` },
  });

  expect(response.status()).toBe(416);
  expect(response.headers()["content-range"]).toBe(`bytes */${whole.byteLength}`);
});

test("a range it can't validate gets the whole original", async ({ request }) => {
  const id = await onlyImageId(request);

  // Multiple ranges, and an If-Range there is no validator to check against.
  const cases: Array<Record<string, string>> = [
    { Range: "bytes=0-1,4-5" },
    { Range: "bytes=0-1", "If-Range": '"some-etag"' },
  ];
  for (const headers of cases) {
    const response = await request.get(`/img/${id}/original`, { headers });
    expect(response.status()).toBe(200);
  }
});

test("HEAD answers with the headers alone", async ({ request }) => {
  const id = await onlyImageId(request);

  const response = await request.head(`/img/${id}/original`, { headers: { Range: "bytes=0-9" } });

  expect(response.status()).toBe(206);
  expect(response.headers()["content-length"]).toBe("10");
  expect((await response.body()).byteLength).toBe(0);
});

test("a range doesn't get around the published-board check", async ({ browser, request }) => {
  const id = await onlyImageId(request);
  const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });

  try {
    const hidden = await stranger.request.get(`/img/${id}/original`, {
      headers: { Range: "bytes=0-9" },
    });
    expect(hidden.status()).toBe(404);

    const boardId = await createBoard(request, "ranges");
    await request.post(`/image/${id}`, { form: { intent: "toggle-board", boardId } });
    await request.post("/boards", { form: { intent: "publish", boardId } });

    const published = await stranger.request.get(`/img/${id}/original`, {
      headers: { Range: "bytes=0-9" },
    });
    expect(published.status()).toBe(206);
    expect(published.headers()["cache-control"]).toContain("public");
  } finally {
    await stranger.close();
  }
});
