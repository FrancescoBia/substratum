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
  const { extensionCorsHeaders } = await import("./cors.server");
  return (origin: string) =>
    extensionCorsHeaders(
      new Request("http://instance/api/capture", { headers: { Origin: origin } }),
    );
}

afterEach(async () => {
  vi.unstubAllEnvs();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
  dataDir = undefined;
});

describe("extensionCorsHeaders", () => {
  test("accepts only the store extension by default", async () => {
    const cors = await loadCors();
    expect(cors(`chrome-extension://${STORE_ID}`)).toMatchObject({
      "Access-Control-Allow-Origin": `chrome-extension://${STORE_ID}`,
      "Access-Control-Allow-Credentials": "true",
    });
    expect(cors(`chrome-extension://${OTHER_ID}`)).toEqual({});
    expect(cors("https://example.com")).toEqual({});
  });

  test("SUBSTRATUM_EXTENSION_ID replaces the store ID", async () => {
    const cors = await loadCors(OTHER_ID);
    expect(cors(`chrome-extension://${OTHER_ID}`)).toMatchObject({
      "Access-Control-Allow-Origin": `chrome-extension://${OTHER_ID}`,
    });
    expect(cors(`chrome-extension://${STORE_ID}`)).toEqual({});
  });
});
