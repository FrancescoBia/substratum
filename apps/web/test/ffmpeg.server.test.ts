import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { extractFrame, ffmpegPath, probe } from "../app/lib/ffmpeg.server.ts";

/**
 * Runs the real binaries against clips generated on the spot — ffmpeg's own
 * test pattern — rather than committed fixtures. CI installs the same pinned
 * build the container ships.
 */

const run = promisify(execFile);
const MODULE = fileURLToPath(new URL("../app/lib/ffmpeg.server.ts", import.meta.url));

let dir: string;
let clip: string;

before(async () => {
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

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("probe", () => {
  test("reads the container, codec, size and duration", async () => {
    const output = await probe(clip);
    const video = output.streams?.find((stream) => stream.codec_type === "video");

    assert.match(output.format?.format_name ?? "", /mp4/);
    assert.equal(video?.codec_name, "h264");
    assert.equal(video?.width, 320);
    assert.equal(video?.height, 240);
    assert.equal(Math.round(Number(output.format?.duration)), 2);
  });

  test("rejects a file that isn't media at all", async () => {
    await assert.rejects(probe(MODULE));
  });
});

describe("extractFrame", () => {
  test("hands back one frame as PNG", async () => {
    const frame = await extractFrame(clip, 1);
    assert.equal(frame.subarray(1, 4).toString("ascii"), "PNG");
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

  assert.ok(result, "loading the module should have failed");
  assert.match(result.stderr ?? "", /needs ffprobe to store videos/);
  assert.match(result.stderr ?? "", /FFPROBE_PATH/);
});
