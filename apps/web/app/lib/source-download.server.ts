import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, type CaptureErrorCode } from "@repo/shared";

export type DownloadResult =
  | { ok: true; size: number }
  | { ok: false; code: CaptureErrorCode; message: string };

/**
 * How long the source may go quiet — before it answers, and between any two
 * chunks after that. Same intent as `REQUEST_TIMEOUT_MS` in `s3.server.ts`:
 * outbound fetches get a bound. A silence is what a dead or throttling host
 * looks like; a slow but steady one keeps resetting this.
 */
const IDLE_TIMEOUT_MS = 15_000;

/**
 * The most a whole download may take, however steadily it trickles in. Three
 * minutes carries a 95 MB video over anything from about 4.5 Mbit/s up — the
 * source is a web server, not a home uplink — and keeps a capture well clear
 * of the five minutes Chrome gives the extension's worker for it.
 */
const DOWNLOAD_CEILING_MS = 3 * 60_000;

/**
 * Downloads the file the extension pointed us at into `path`, streaming it to
 * disk rather than holding it in memory — at up to 95 MB a video is how a
 * small instance runs out of it.
 *
 * Whether it is an image or a video, and whether it is kept, is decided
 * afterwards from its bytes (see `ingestFile`). Here it is only cut off once it
 * passes the larger of the two caps.
 *
 * The Referer is set to the page it was found on, which is what gets past most
 * hotlink protection. The caller owns `path` and removes it either way.
 */
export async function downloadSource(
  sourceUrl: string,
  sourcePageUrl: string,
  path: string,
): Promise<DownloadResult> {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return { ok: false, code: "invalid-request", message: "That address isn't valid." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      code: "invalid-request",
      message: "Only files served over http or https can be saved.",
    };
  }

  const controller = new AbortController();
  // The first reason to stop wins, so an abort's own error never replaces it.
  let failure: { code: CaptureErrorCode; message: string } | null = null;
  const stop = (code: CaptureErrorCode, message: string) => {
    failure ??= { code, message };
    controller.abort();
  };

  let idle: NodeJS.Timeout | undefined;
  const stillAlive = () => {
    clearTimeout(idle);
    idle = setTimeout(
      () => stop("fetch-failed", "The site stopped answering partway through."),
      IDLE_TIMEOUT_MS,
    );
  };
  const ceiling = setTimeout(
    () => stop("fetch-failed", "That took too long to download."),
    DOWNLOAD_CEILING_MS,
  );

  try {
    stillAlive();
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: sourcePageUrl ? { Referer: sourcePageUrl } : undefined,
    });

    if (!response.ok) {
      return {
        ok: false,
        code: "fetch-failed",
        message: `The site answered ${response.status} instead of the file.`,
      };
    }

    // Headers are only an early bail-out; the real checks are on the bytes.
    const tooLarge = tooLargeByHeaders(response.headers);
    if (tooLarge) return { ok: false, code: "too-large", message: tooLarge };

    let size = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.byteLength;
        if (size > MAX_VIDEO_BYTES) {
          stop("too-large", "That file is larger than 95 MB, the most Substratum stores.");
          callback(new Error("over the size cap"));
          return;
        }
        stillAlive();
        callback(null, chunk);
      },
    });

    await pipeline(
      response.body
        ? Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>)
        : Readable.from([]),
      meter,
      createWriteStream(path),
    );
    return { ok: true, size };
  } catch {
    // Annotated again because TypeScript can't see the timers and the meter
    // assign it, and would otherwise take it for still null here.
    const reason = failure as { code: CaptureErrorCode; message: string } | null;
    return reason
      ? { ok: false, ...reason }
      : { ok: false, code: "fetch-failed", message: "Couldn't download that file." };
  } finally {
    clearTimeout(idle);
    clearTimeout(ceiling);
  }
}

/**
 * Why the response's own headers already rule it out, or null. A declared
 * image gets the image cap; anything else the video one, since what it really
 * is isn't known until its bytes are.
 */
function tooLargeByHeaders(headers: Headers): string | null {
  const declared = Number(headers.get("content-length") ?? 0);
  if (declared > MAX_VIDEO_BYTES) {
    return "That file is larger than 95 MB, the most Substratum stores.";
  }
  if (headers.get("content-type")?.startsWith("image/") && declared > MAX_IMAGE_BYTES) {
    return "That image is larger than 50 MB.";
  }
  return null;
}
