import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, assert, beforeAll, describe, expect, test } from "vitest";
import { ffmpegPath, probe } from "./ffmpeg.server";
import { sniffMedia, SNIFF_BYTES } from "./media-sniff";
import { describeVideo } from "./video-metadata";

/**
 * What an upload is taken for, and what ingest makes of it. Clips are made on
 * the spot from ffmpeg's test pattern, one per container and codec that ingest
 * has an opinion about.
 */

const run = promisify(execFile);

let dir: string;
const clips: Record<string, string> = {};

/** Two seconds of test pattern at 320×240, encoded however `args` says. */
async function makeClip(name: string, args: string[]) {
  const path = join(dir, name);
  await run(ffmpegPath, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x240:rate=25:duration=2",
    ...args,
    path,
  ]);
  clips[name] = path;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "substratum-media-"));
  await Promise.all([
    makeClip("h264.mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p"]),
    makeClip("h264.mov", ["-c:v", "libx264", "-pix_fmt", "yuv420p"]),
    makeClip("vp9.webm", ["-c:v", "libvpx-vp9", "-deadline", "realtime"]),
    makeClip("vp9.mkv", ["-c:v", "libvpx-vp9", "-deadline", "realtime"]),
    makeClip("hevc.mp4", ["-c:v", "libx265", "-x265-params", "log-level=none", "-tag:v", "hvc1"]),
  ]);

  // Stored landscape, displayed portrait — the way a phone films.
  clips["rotated.mp4"] = join(dir, "rotated.mp4");
  await run(ffmpegPath, [
    "-v",
    "error",
    "-display_rotation",
    "90",
    "-i",
    clips["h264.mp4"],
    "-c",
    "copy",
    clips["rotated.mp4"],
  ]);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function head(name: string) {
  return (await readFile(clips[name])).subarray(0, SNIFF_BYTES);
}

describe("sniffMedia", () => {
  test("tells the accepted containers apart", async () => {
    expect(sniffMedia(await head("h264.mp4"))).toStrictEqual({ kind: "video", container: "mp4" });
    expect(sniffMedia(await head("h264.mov"))).toStrictEqual({ kind: "video", container: "mov" });
    expect(sniffMedia(await head("vp9.webm"))).toStrictEqual({ kind: "video", container: "webm" });
  });

  test("names a video container it won't take", async () => {
    expect(sniffMedia(await head("vp9.mkv"))).toStrictEqual({
      kind: "unsupported-video",
      container: "MKV",
    });
    const avi = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("AVI LIST")]);
    expect(sniffMedia(avi)).toStrictEqual({ kind: "unsupported-video", container: "AVI" });
  });

  test("leaves stills to sharp, AVIF included", () => {
    const avif = Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from("ftypavif")]);
    expect(sniffMedia(avif)).toStrictEqual({ kind: "image" });
    expect(sniffMedia(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toStrictEqual({ kind: "image" });
    expect(sniffMedia(Buffer.alloc(0))).toStrictEqual({ kind: "image" });
  });
});

describe("describeVideo", () => {
  test("accepts H.264 and VP9, and reads size and duration", async () => {
    for (const [name, container] of [
      ["h264.mp4", "mp4"],
      ["h264.mov", "mov"],
      ["vp9.webm", "webm"],
    ] as const) {
      const verdict = describeVideo(await probe(clips[name]), container);
      assert(verdict.ok, `${name} should be accepted`);
      expect(verdict.video.width).toBe(320);
      expect(verdict.video.height).toBe(240);
      assert(Math.abs((verdict.video.durationMs ?? 0) - 2000) < 100, name);
    }
  });

  test("reports a rotated video at the size it is shown", async () => {
    const verdict = describeVideo(await probe(clips["rotated.mp4"]), "mp4");
    assert(verdict.ok);
    expect(verdict.video.width).toBe(240);
    expect(verdict.video.height).toBe(320);
  });

  test("refuses HEVC, saying what to do instead", async () => {
    const verdict = describeVideo(await probe(clips["hevc.mp4"]), "mp4");
    assert(!verdict.ok);
    expect(verdict.message).toMatch(/HEVC/);
    expect(verdict.message).toMatch(/export it as H\.264/);
  });

  test("refuses a file whose header and contents disagree", async () => {
    const verdict = describeVideo(await probe(clips["vp9.webm"]), "mp4");
    assert(!verdict.ok);
  });

  test("refuses a file with no video stream", () => {
    const verdict = describeVideo(
      {
        format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "3.0" },
        streams: [{ codec_type: "audio", codec_name: "aac" }],
      },
      "mp4",
    );
    expect(verdict).toStrictEqual({ ok: false, message: "That file has no video in it." });
  });

  test("takes cover art for what it is, not the video", () => {
    const verdict = describeVideo(
      {
        format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
        streams: [
          { codec_type: "video", codec_name: "mjpeg", disposition: { attached_pic: 1 } },
          { codec_type: "video", codec_name: "h264", width: 640, height: 360 },
        ],
      },
      "mp4",
    );
    assert(verdict.ok);
    expect(verdict.video.codec).toBe("h264");
    // No duration anywhere in the container is recorded as unknown.
    expect(verdict.video.durationMs).toBe(null);
  });
});
