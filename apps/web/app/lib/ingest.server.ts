import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  ACCEPTED_FORMATS,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  type AcceptedVideoFormat,
  type CaptureErrorCode,
} from "@repo/shared";
import sharp, { type Metadata } from "sharp";
import { db, schema } from "~/db/index.server";
import { extractFrame, probe, type ProbeOutput } from "./ffmpeg.server";
import { MEDIUM_EDGE, THUMB_EDGE } from "./image-variants";
import { sniffMedia } from "./media-sniff";
import { storage, storageKeys } from "./storage.server";
import { readHead } from "./upload.server";
import { describeVideo } from "./video-metadata";

/**
 * Where an Image came from. Null for one the Owner uploaded by hand — there is
 * no source page to record, and none is invented.
 */
export type IngestSource = {
  sourceImageUrl: string;
  sourcePageUrl: string;
  sourcePageTitle: string;
} | null;

export type IngestResult =
  | { ok: true; id: string }
  | { ok: false; code: CaptureErrorCode; message: string };

/**
 * Sends a file on disk down the image or video path, by what its bytes say it
 * is — the door both manual upload and extension capture come in through.
 * Like `ingestVideo`, it may move the file away; the caller removes whatever is
 * left at `path` either way.
 */
export async function ingestFile(
  path: string,
  size: number,
  source: IngestSource,
): Promise<IngestResult> {
  const sniffed = sniffMedia(await readHead(path));

  if (sniffed.kind === "unsupported-video") {
    return {
      ok: false,
      code: "unsupported-format",
      message: `${sniffed.container} videos aren't supported — export it as MP4 or WebM to save it.`,
    };
  }

  if (sniffed.kind === "video") {
    return ingestVideo(path, size, sniffed.container, source);
  }

  // Stills are small enough to take into memory, as they always have been —
  // but a 90 MB file that only claims to be one is refused before it is read.
  if (size > MAX_IMAGE_BYTES) {
    return { ok: false, code: "too-large", message: "That image is larger than 50 MB." };
  }
  return ingestImage(await readFile(path), source);
}

/**
 * The single path by which bytes become an Image — shared by manual upload and
 * by extension capture, so the two can never drift in what they accept or how
 * they store it.
 *
 * Nothing is written unless every step succeeds: a failure leaves no row and no
 * orphaned file.
 */
export async function ingestImage(bytes: Buffer, source: IngestSource): Promise<IngestResult> {
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return { ok: false, code: "too-large", message: "That image is larger than 50 MB." };
  }
  if (bytes.byteLength === 0) {
    return { ok: false, code: "invalid-request", message: "That file is empty." };
  }

  // Format comes from the bytes, never from the URL or a declared content-type.
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes).metadata();
  } catch {
    return { ok: false, code: "unsupported-format", message: "That file isn't an image." };
  }

  const format = metadata.format;
  if (!format || !(ACCEPTED_FORMATS as readonly string[]).includes(format)) {
    return {
      ok: false,
      code: "unsupported-format",
      message: `Substratum stores raster images (${ACCEPTED_FORMATS.join(", ")}), not ${format ?? "that format"}.`,
    };
  }
  if (!metadata.width || !metadata.height) {
    return { ok: false, code: "unsupported-format", message: "That image has no dimensions." };
  }

  const id = randomUUID();

  return commit(
    id,
    // An animated GIF gets a still first frame as its derivative; the original
    // keeps its animation for the detail view.
    async () => {
      const [thumb, medium] = await deriveVariants(bytes);
      return [
        storage.put(storageKeys.original(id, format), bytes),
        storage.put(storageKeys.thumb(id), thumb),
        storage.put(storageKeys.medium(id), medium),
      ];
    },
    {
      id,
      kind: "image",
      storageKey: storageKeys.original(id, format),
      width: metadata.width,
      height: metadata.height,
      format,
      byteSize: bytes.byteLength,
      sourceImageUrl: source?.sourceImageUrl ?? null,
      sourcePageUrl: source?.sourcePageUrl ?? null,
      sourcePageTitle: source?.sourcePageTitle ?? null,
      savedAt: Date.now(),
    },
  );
}

/**
 * The video counterpart to `ingestImage`, for a file already spooled to disk —
 * at up to 95 MB it is never read into memory. Takes the file: on success it
 * has been moved into storage, and either way the caller removes whatever is
 * left at `path`.
 *
 * `container` is what the file's leading bytes said it is (see `sniffMedia`);
 * ffprobe has to agree before anything is kept. The poster frame becomes the
 * `thumb` and `medium` derivatives exactly as a still would, so every grid,
 * board and export treats a video's derivatives like any other.
 */
export async function ingestVideo(
  path: string,
  byteSize: number,
  container: AcceptedVideoFormat,
  source: IngestSource,
): Promise<IngestResult> {
  if (byteSize > MAX_VIDEO_BYTES) {
    return { ok: false, code: "too-large", message: "That video is larger than 95 MB." };
  }
  if (byteSize === 0) {
    return { ok: false, code: "invalid-request", message: "That file is empty." };
  }

  let probed: ProbeOutput;
  try {
    probed = await probe(path);
  } catch {
    return {
      ok: false,
      code: "unsupported-format",
      message: "That video file is damaged, or isn't a video ffmpeg can read.",
    };
  }

  const verdict = describeVideo(probed, container);
  if (!verdict.ok) return { ok: false, code: "unsupported-format", message: verdict.message };
  const { video } = verdict;

  // A second in skips the fade from black most motion pieces open on; half way
  // through covers clips shorter than two seconds. A container that never says
  // how long it is gets the second, and the first frame if that misses.
  const posterAt = video.durationMs === null ? 1 : Math.min(1, video.durationMs / 2000);

  const id = randomUUID();

  return commit(
    id,
    async () => {
      const frame = await extractFrame(path, posterAt).catch(() => extractFrame(path, 0));
      const [thumb, medium] = await deriveVariants(frame);
      return [
        storage.put(storageKeys.thumb(id), thumb),
        storage.put(storageKeys.medium(id), medium),
        storage.putFile(storageKeys.original(id, container), path),
      ];
    },
    {
      id,
      kind: "video",
      storageKey: storageKeys.original(id, container),
      width: video.width,
      height: video.height,
      format: container,
      byteSize,
      durationMs: video.durationMs,
      sourceImageUrl: source?.sourceImageUrl ?? null,
      sourcePageUrl: source?.sourcePageUrl ?? null,
      sourcePageTitle: source?.sourcePageTitle ?? null,
      savedAt: Date.now(),
    },
  );
}

/** The `thumb` and `medium` WebPs of a still: an image itself, or a video's poster. */
function deriveVariants(still: Buffer): Promise<[Buffer, Buffer]> {
  const derive = (edge: number) =>
    sharp(still)
      .resize(edge, edge, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

  return Promise.all([derive(THUMB_EDGE), derive(MEDIUM_EDGE)]);
}

/**
 * Stores an Image's bytes and then records it — all of it, or none.
 *
 * `write` starts every storage write and hands them back together rather than
 * awaiting each: against a bucket they are independent network round trips on
 * the request the Owner is waiting on, and nothing orders them. Any failure,
 * in deriving or in writing, removes whatever did land and records nothing.
 */
async function commit(
  id: string,
  write: () => Promise<Array<Promise<void>>>,
  row: typeof schema.images.$inferInsert,
): Promise<IngestResult> {
  try {
    const writes = await Promise.allSettled(await write());
    const failed = writes.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
  } catch (error) {
    await discardStoredBytes(id);
    return {
      ok: false,
      code: "server-error",
      message: error instanceof Error ? error.message : "Couldn't process that file.",
    };
  }

  try {
    await db.insert(schema.images).values(row);
  } catch (error) {
    await discardStoredBytes(id);
    return {
      ok: false,
      code: "server-error",
      message: error instanceof Error ? error.message : "Couldn't save that file.",
    };
  }

  return { ok: true, id };
}

/**
 * Rolls back whatever made it into storage before the failure.
 *
 * Best-effort by necessity — the ingest has already failed and there is nothing
 * better to report — but not silent. Against a bucket this is a list plus a
 * batch delete over the network, so it can fail on its own, and what it leaves
 * behind is objects with no row pointing at them. `purgeExpiredTrash` walks
 * database rows, so nothing will ever find them again; a log line is the only
 * thread back to them.
 */
async function discardStoredBytes(id: string): Promise<void> {
  try {
    await storage.deletePrefix(storageKeys.prefix(id));
  } catch (error) {
    console.error(`[ingest] could not clean up ${id}; its stored bytes are orphaned:`, error);
  }
}
