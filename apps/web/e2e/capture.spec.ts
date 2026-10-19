import { readdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { MAX_VIDEO_BYTES, type CaptureResponse } from "@repo/shared";
import { unzipSync } from "fflate";
import { mp4, png, resetLibrary, video } from "./helpers";
import type { Manifest } from "~/lib/export.server";

/**
 * What the extension's right-click does, without the extension: `/api/capture`
 * is handed URLs and downloads the file itself. The "site" it downloads from is
 * a server this test runs, so each source can misbehave in exactly one way.
 */

type Route = (response: import("node:http").ServerResponse) => void | Promise<void>;

let site: Server;
let siteUrl: string;
const routes = new Map<string, Route>();

/** Serves `body` whole, with an honest length and the given type. */
const file =
  (body: Buffer, type: string): Route =>
  (response) => {
    response.writeHead(200, { "Content-Type": type, "Content-Length": body.byteLength });
    response.end(body);
  };

test.beforeAll(async () => {
  site = createServer((request, response) => {
    const route = routes.get(request.url ?? "");
    if (!route) {
      response.writeHead(404).end();
      return;
    }
    void route(response);
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;

  routes.set("/clip.mp4", file(await mp4(), "video/mp4"));
  routes.set("/still.png", file(await png(400, 300, [48, 110, 180]), "image/png"));
  routes.set(
    "/clip.webm",
    file(await video("webm", ["-c:v", "libvpx-vp9", "-deadline", "realtime"]), "video/webm"),
  );
  routes.set(
    "/clip.mkv",
    file(await video("mkv", ["-c:v", "libvpx-vp9", "-deadline", "realtime"]), "video/x-matroska"),
  );
  routes.set(
    "/hevc.mp4",
    file(
      await video("mp4", ["-c:v", "libx265", "-x265-params", "log-level=none", "-tag:v", "hvc1"]),
      "video/mp4",
    ),
  );
});

test.afterAll(async () => {
  site.closeAllConnections();
  await new Promise((resolve) => site.close(resolve));
});

test.beforeEach(async ({ request }) => {
  await resetLibrary(request);
});

async function capture(request: APIRequestContext, path: string) {
  const response = await request.post("/api/capture", {
    form: {
      sourceImageUrl: siteUrl + path,
      sourcePageUrl: `${siteUrl}/gallery`,
      sourcePageTitle: "A gallery",
    },
    timeout: 60_000,
  });
  return { status: response.status(), body: (await response.json()) as CaptureResponse };
}

/** Nothing a capture downloaded outlives its request, kept or refused. */
async function expectSpoolEmpty() {
  const left = await readdir(".playwright-data/tmp").catch(() => []);
  expect(left).toEqual([]);
}

async function manifest(request: APIRequestContext): Promise<Manifest> {
  const files = unzipSync(new Uint8Array(await (await request.get("/export")).body()));
  return JSON.parse(new TextDecoder().decode(files["manifest.json"])) as Manifest;
}

test("a captured MP4 is stored as a video, with where it came from", async ({ request }) => {
  const { status, body } = await capture(request, "/clip.mp4");
  expect(body).toMatchObject({ ok: true });
  expect(status).toBe(200);

  const { images } = await manifest(request);
  expect(images).toHaveLength(1);
  expect(images[0]).toMatchObject({
    kind: "video",
    format: "mp4",
    width: 320,
    height: 240,
    source: {
      imageUrl: `${siteUrl}/clip.mp4`,
      pageUrl: `${siteUrl}/gallery`,
      pageTitle: "A gallery",
    },
  });
  expect(images[0].durationMs).toBeGreaterThan(1500);
  await expectSpoolEmpty();
});

test("WebM captures too, and images still capture as images", async ({ request }) => {
  expect((await capture(request, "/clip.webm")).body).toMatchObject({ ok: true });
  expect((await capture(request, "/still.png")).body).toMatchObject({ ok: true });

  const { images } = await manifest(request);
  expect(images.map((image) => `${image.kind}/${image.format}`).sort()).toEqual([
    "image/png",
    "video/webm",
  ]);
});

test("a video ingest refuses is refused the same way when captured", async ({ request }) => {
  const mkv = await capture(request, "/clip.mkv");
  expect(mkv.status).toBe(422);
  expect(mkv.body).toEqual({
    ok: false,
    code: "unsupported-format",
    message: "MKV videos aren't supported — export it as MP4 or WebM to save it.",
  });

  const hevc = await capture(request, "/hevc.mp4");
  expect(hevc.body).toMatchObject({ ok: false, code: "unsupported-format" });
  expect(hevc.body.ok || hevc.body.message).toContain("H.264");

  expect((await manifest(request)).images).toEqual([]);
  await expectSpoolEmpty();
});

test("a source declaring more than the cap is refused before it is read", async ({ request }) => {
  routes.set("/declared-huge.mp4", (response) => {
    response.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": MAX_VIDEO_BYTES + 1 });
    // Never sends the body: the headers alone have to be enough.
    response.flushHeaders();
  });

  const { status, body } = await capture(request, "/declared-huge.mp4");
  expect(status).toBe(422);
  expect(body).toMatchObject({ ok: false, code: "too-large" });
});

test("a source that streams past the cap is cut off there", async ({ request }) => {
  // No length declared, so only counting the bytes can catch it.
  routes.set("/endless.mp4", async (response) => {
    response.writeHead(200, { "Content-Type": "video/mp4" });
    const chunk = Buffer.alloc(1024 * 1024);
    for (let sent = 0; sent <= MAX_VIDEO_BYTES + chunk.byteLength && !response.destroyed;) {
      if (!response.write(chunk)) await new Promise((resolve) => response.once("drain", resolve));
      sent += chunk.byteLength;
    }
    response.end();
  });

  const { status, body } = await capture(request, "/endless.mp4");
  expect(status).toBe(422);
  expect(body).toMatchObject({ ok: false, code: "too-large" });
  expect((await manifest(request)).images).toEqual([]);
  await expectSpoolEmpty();
});

test("a slow capture starts answering early and still ends in the verdict", async ({ request }) => {
  test.setTimeout(60_000);
  const clip = await mp4();
  routes.set("/slow.mp4", (response) => {
    response.writeHead(200, { "Content-Type": "video/mp4" });
    response.write(clip.subarray(0, 64));
    // Past the instance's 10s answer-by, inside its 15s idle limit.
    setTimeout(() => response.end(clip.subarray(64)), 12_000);
  });

  const startedAt = Date.now();
  const response = await request.post("/api/capture", {
    form: { sourceImageUrl: `${siteUrl}/slow.mp4`, sourcePageUrl: "", sourcePageTitle: "" },
    timeout: 60_000,
  });
  const text = await response.text();

  // Whitespace first, the verdict last, and the whole thing still plain JSON.
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-transform");
  expect(text).toMatch(/^ +\{/);
  expect(JSON.parse(text)).toMatchObject({ ok: true });
  expect(Date.now() - startedAt).toBeGreaterThan(11_000);

  const { images } = await manifest(request);
  expect(images.map((image) => image.kind)).toEqual(["video"]);
});

test("a source that answers with an error says so", async ({ request }) => {
  routes.set("/forbidden.mp4", (response) => void response.writeHead(403).end());

  const { status, body } = await capture(request, "/forbidden.mp4");
  expect(status).toBe(422);
  expect(body).toEqual({
    ok: false,
    code: "fetch-failed",
    message: "The site answered 403 instead of the file.",
  });
});
