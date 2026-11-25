import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

let dataDir: string;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "substratum-capture-"));
  vi.stubEnv("SUBSTRATUM_DATA_DIR", dataDir);
  vi.stubEnv("SUBSTRATUM_SKIP_ENV_FILE", "1");
  vi.stubEnv("S3_BUCKET", "");
  vi.stubEnv("SUBSTRATUM_EXTENSION_ID", "");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(dataDir, { recursive: true, force: true });
});

test("turns another extension away before reading the session or the form", async () => {
  const { action } = await import("./api.capture");
  const request = new Request("http://instance/api/capture", {
    method: "POST",
    headers: { Origin: "chrome-extension://aaaabbbbccccddddeeeeffffgggghhhh" },
    body: new URLSearchParams({ sourceImageUrl: "https://example.com/a.png" }),
  });

  const response = await action({ request } as Parameters<typeof action>[0]);

  expect(response.status).toBe(403);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  expect(await request.text()).toContain("sourceImageUrl");
});
