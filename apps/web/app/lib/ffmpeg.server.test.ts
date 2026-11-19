import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, assert, beforeAll, describe, expect, test } from "vitest";
import { extractFrame, ffmpegPath, probe } from "./ffmpeg.server";

/**
 * Runs the real binaries against clips generated on the spot — ffmpeg's own
 * test pattern — rather than committed fixtures. CI installs the same pinned
 * build the container ships.
 */

const run = promisify(execFile);
const MODULE = fileURLToPath(new URL("./ffmpeg.server.ts", import.meta.url));

let dir: string;
let clip: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "substratum-ffmpeg-"));
  clip = join(dir, "clip.mp4");
  await run(ffmpegPath, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x240:rate=25:duration=2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    clip,
  ]);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("probe", () => {
  test("reads the container, codec, size and duration", async () => {
    const output = await probe(clip);
    const video = output.streams?.find((stream) => stream.codec_type === "video");

    expect(output.format?.format_name ?? "").toMatch(/mp4/);
    expect(video?.codec_name).toBe("h264");
    expect(video?.width).toBe(320);
    expect(video?.height).toBe(240);
    expect(Math.round(Number(output.format?.duration))).toBe(2);
  });

  test("rejects a file that isn't media at all", async () => {
    await expect(probe(MODULE)).rejects.toThrow();
  });
});

describe("extractFrame", () => {
  test("hands back one frame as PNG", async () => {
    const frame = await extractFrame(clip, 1);
    expect(frame.subarray(1, 4).toString("ascii")).toBe("PNG");
  });
});

test("refuses to load when a binary can't be run", async () => {
  const result = await run(
    process.execPath,
    ["--input-type=module", "-e", `await import(${JSON.stringify(MODULE)})`],
    { env: { ...process.env, FFPROBE_PATH: join(dir, "no-such-ffprobe") } },
  ).then(
    () => null,
    (error: { code?: number; stderr?: string }) => error,
  );

  assert(result, "loading the module should have failed");
  expect(result.stderr ?? "").toMatch(/needs ffprobe to store videos/);
  expect(result.stderr ?? "").toMatch(/FFPROBE_PATH/);
});
