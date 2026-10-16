import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

/**
 * The two ffmpeg binaries video ingest shells out to: `ffprobe` to read what a
 * file actually is, `ffmpeg` to pull a poster frame from it. `sharp` reads
 * neither containers nor codecs, and nothing in pure JS covers MP4, MOV and
 * WebM alike.
 *
 * The container image ships pinned static builds of both (see the Dockerfile).
 * Anywhere else they come from PATH, or from FFMPEG_PATH / FFPROBE_PATH when
 * they live somewhere PATH doesn't reach.
 *
 * Dependency-free beyond Node, so the unit tests can load it directly.
 */
export const ffmpegPath = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
export const ffprobePath = process.env.FFPROBE_PATH?.trim() || "ffprobe";

/**
 * Checked once, when this module loads, rather than at the first video: an
 * instance that boots without them would accept uploads and fail every video,
 * and the Owner would learn about a missing binary from an error toast. Same
 * stance as a half-configured bucket in `config.server.ts` — refuse to start.
 *
 * In the production build every route is loaded at startup, so this runs before
 * the first request. Under the dev server modules load on demand, so there it
 * runs on the first request that touches ingest.
 */
for (const [name, path, variable] of [
  ["ffmpeg", ffmpegPath, "FFMPEG_PATH"],
  ["ffprobe", ffprobePath, "FFPROBE_PATH"],
] as const) {
  try {
    execFileSync(path, ["-version"], { stdio: "ignore", timeout: 10_000 });
  } catch (error) {
    throw new Error(
      `Substratum needs ${name} to store videos, and could not run ${JSON.stringify(path)}. ` +
        `Install ffmpeg (e.g. \`brew install ffmpeg\`), or set ${variable} to the binary.`,
      { cause: error },
    );
  }
}

const run = promisify(execFile);

/**
 * How long either binary gets on one file. Probing reads headers and grabbing
 * one frame decodes a handful, so both finish in well under a second on any
 * file ingest accepts; this only catches a pathological file or a wedged
 * process.
 */
const TIMEOUT_MS = 30_000;

/** The parts of `ffprobe -show_format -show_streams` that ingest reads. */
export type ProbeOutput = {
  format?: {
    format_name?: string;
    duration?: string;
    tags?: Record<string, string>;
  };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    tags?: Record<string, string>;
    side_data_list?: Array<{ side_data_type?: string; rotation?: number }>;
    disposition?: Record<string, number>;
  }>;
};

/**
 * Everything ffprobe can say about a file's container and streams. Rejects when
 * ffprobe can't read the file at all — which for ingest means it isn't a video.
 */
export async function probe(path: string): Promise<ProbeOutput> {
  const { stdout } = await run(
    ffprobePath,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
    { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as ProbeOutput;
}

/**
 * One frame, `seconds` in, as PNG bytes — a lossless handoff to `sharp`, which
 * makes the derivatives exactly as it does for a still.
 *
 * `-ss` before `-i` seeks by keyframe and then decodes forward to the exact
 * time, which is fast and still frame-accurate.
 */
export async function extractFrame(path: string, seconds: number): Promise<Buffer> {
  const { stdout } = await run(
    ffmpegPath,
    [
      "-v",
      "error",
      "-ss",
      seconds.toFixed(3),
      "-i",
      path,
      "-frames:v",
      "1",
      "-f",
      "image2pipe",
      "-c:v",
      "png",
      "pipe:1",
    ],
    // A 4K frame as PNG runs to tens of megabytes.
    { encoding: "buffer", timeout: TIMEOUT_MS, maxBuffer: 128 * 1024 * 1024 },
  );
  if (stdout.byteLength === 0) throw new Error(`ffmpeg produced no frame at ${seconds}s`);
  return stdout;
}
