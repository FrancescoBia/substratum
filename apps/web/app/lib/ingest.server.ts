import { randomUUID } from "node:crypto";
import { ACCEPTED_FORMATS, MAX_IMAGE_BYTES, type CaptureErrorCode } from "@repo/shared";
import sharp, { type Metadata } from "sharp";
import { db, schema } from "~/db/index.server";
import { storage, storageKeys } from "./storage.server";

/** Long edge of each derivative, in pixels. */
const THUMB_EDGE = 400;
const MEDIUM_EDGE = 1200;

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

  try {
    // An animated GIF gets a still first frame as its derivative; the original
    // keeps its animation for the detail view.
    const derive = (edge: number) =>
      sharp(bytes)
        .resize(edge, edge, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();

    const [thumb, medium] = await Promise.all([derive(THUMB_EDGE), derive(MEDIUM_EDGE)]);

    await storage.put(storageKeys.original(id, format), bytes);
    await storage.put(storageKeys.thumb(id), thumb);
    await storage.put(storageKeys.medium(id), medium);
  } catch (error) {
    await storage.deletePrefix(storageKeys.prefix(id)).catch(() => {});
    return {
      ok: false,
      code: "server-error",
      message: error instanceof Error ? error.message : "Couldn't process that image.",
    };
  }

  try {
    await db.insert(schema.images).values({
      id,
      storageKey: storageKeys.original(id, format),
      width: metadata.width,
      height: metadata.height,
      format,
      byteSize: bytes.byteLength,
      sourceImageUrl: source?.sourceImageUrl ?? null,
      sourcePageUrl: source?.sourcePageUrl ?? null,
      sourcePageTitle: source?.sourcePageTitle ?? null,
      savedAt: Date.now(),
    });
  } catch (error) {
    await storage.deletePrefix(storageKeys.prefix(id)).catch(() => {});
    return {
      ok: false,
      code: "server-error",
      message: error instanceof Error ? error.message : "Couldn't save that image.",
    };
  }

  return { ok: true, id };
}

/** Fetch timeout for server-side capture. */
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Downloads an image the extension pointed us at. The Referer is set to the
 * page the image was found on, which is what gets past most hotlink protection.
 */
export async function fetchSourceImage(
  sourceImageUrl: string,
  sourcePageUrl: string,
): Promise<{ ok: true; bytes: Buffer } | { ok: false; code: CaptureErrorCode; message: string }> {
  let url: URL;
  try {
    url = new URL(sourceImageUrl);
  } catch {
    return { ok: false, code: "invalid-request", message: "That image URL isn't valid." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, code: "invalid-request", message: "Only http and https images can be saved." };
  }

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: sourcePageUrl ? { Referer: sourcePageUrl } : undefined,
    });

    if (!response.ok) {
      return {
        ok: false,
        code: "fetch-failed",
        message: `The site returned ${response.status} for that image.`,
      };
    }

    // Trust the header only as an early bail-out; the real check is on bytes.
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_IMAGE_BYTES) {
      return { ok: false, code: "too-large", message: "That image is larger than 50 MB." };
    }

    return { ok: true, bytes: Buffer.from(await response.arrayBuffer()) };
  } catch (error) {
    return {
      ok: false,
      code: "fetch-failed",
      message:
        error instanceof Error && error.name === "TimeoutError"
          ? "That image took too long to download."
          : "Couldn't download that image.",
    };
  }
}
