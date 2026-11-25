import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const STORE_ID = "ddccplpcigefckbilighclpnaacpaodn";
const OTHER_ID = "aaaabbbbccccddddeeeeffffgggghhhh";

let dataDir: string | undefined;

// config.server.ts reads its env once, at import, and creates its data
// directory, so each case gets a fresh module and its own scratch directory.
async function loadCors(extensionId?: string) {
  dataDir = await mkdtemp(join(tmpdir(), "substratum-cors-"));
  vi.resetModules();
  vi.stubEnv("SUBSTRATUM_DATA_DIR", dataDir);
  vi.stubEnv("SUBSTRATUM_SKIP_ENV_FILE", "1");
  vi.stubEnv("S3_BUCKET", "");
  vi.stubEnv("SUBSTRATUM_EXTENSION_ID", extensionId ?? "");
  const cors = await import("./cors.server");
  const request = (origin: string | null) =>
    new Request("http://instance/api/capture", {
      method: "POST",
      headers: origin ? { Origin: origin } : {},
    });
  return {
    headers: (origin: string) => cors.extensionCorsHeaders(request(origin)),
    isOther: (origin: string | null) => cors.isOtherExtension(request(origin)),
  };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  dataDir = undefined;
});

describe("extensionCorsHeaders", () => {
  test("accepts only the store extension by default", async () => {
    const { headers } = await loadCors();
    expect(headers(`chrome-extension://${STORE_ID}`)).toMatchObject({
      "Access-Control-Allow-Origin": `chrome-extension://${STORE_ID}`,
      "Access-Control-Allow-Credentials": "true",
    });
    expect(headers(`chrome-extension://${OTHER_ID}`)).toEqual({});
    expect(headers("https://example.com")).toEqual({});
  });

  test("SUBSTRATUM_EXTENSION_ID replaces the store ID", async () => {
    const { headers } = await loadCors(OTHER_ID);
    expect(headers(`chrome-extension://${OTHER_ID}`)).toMatchObject({
      "Access-Control-Allow-Origin": `chrome-extension://${OTHER_ID}`,
    });
    expect(headers(`chrome-extension://${STORE_ID}`)).toEqual({});
  });
});

describe("isOtherExtension", () => {
  test("flags only extensions that aren't the allowed one", async () => {
    const { isOther } = await loadCors();
    expect(isOther(`chrome-extension://${OTHER_ID}`)).toBe(true);
    expect(isOther(`chrome-extension://${STORE_ID}`)).toBe(false);
  });

  test("leaves requests without an extension origin alone", async () => {
    const { isOther } = await loadCors();
    expect(isOther(null)).toBe(false);
    expect(isOther("https://example.com")).toBe(false);
  });

  test("follows SUBSTRATUM_EXTENSION_ID", async () => {
    const { isOther } = await loadCors(OTHER_ID);
    expect(isOther(`chrome-extension://${OTHER_ID}`)).toBe(false);
    expect(isOther(`chrome-extension://${STORE_ID}`)).toBe(true);
  });
});
