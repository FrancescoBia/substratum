import { contentTypeForFormat } from "@repo/shared";
import { eq } from "drizzle-orm";
import { getOwnerFromSession } from "~/auth/session.server";
import { db, schema } from "~/db/index.server";
import { parseRange } from "~/lib/byte-range";
import { contentDisposition, downloadFilename } from "~/lib/download-name";
import { isPubliclyVisible } from "~/lib/library.server";
import {
  RangeNotSatisfiable,
  storage,
  storageKeys,
  StorageNotFound,
  type Variant,
} from "~/lib/storage.server";
import type { Route } from "./+types/img.$id.$variant";

/**
 * Serves stored image bytes.
 *
 * The Owner sees everything. Everyone else sees an image only while it sits on a
 * published Board — that check is what lets public board pages load their images
 * without opening up the rest of the library. Trashing an image or unpublishing
 * its board closes this off immediately.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  const variant = params.variant as Variant;
  if (variant !== "thumb" && variant !== "medium" && variant !== "original") {
    throw new Response("Unknown variant", { status: 404 });
  }

  const owner = await getOwnerFromSession(request);
  const isOwner = owner !== null;

  const [image] = await db.select().from(schema.images).where(eq(schema.images.id, params.id));
  if (!image || image.deletedAt !== null) {
    throw new Response("Not found", { status: 404 });
  }

  if (!isOwner && !(await isPubliclyVisible(image.id))) {
    // Deliberately 404 rather than 401: whether an image exists at all is not
    // something a stranger should be able to probe.
    throw new Response("Not found", { status: 404 });
  }

  // Public responses may sit in shared caches; the Owner's must not, since the
  // same URL 404s for everyone else. Stored bytes never change for a given id,
  // so either way they cache hard.
  //
  // The name rides along with them: it is what "Save Image As…" and dragging
  // to the desktop call the file, which would otherwise be the URL's last
  // segment — the variant. A derivative is named for the Image too, as a WebP.
  const servedFormat = variant === "original" ? image.format : "webp";
  const baseHeaders = {
    "Cache-Control": isOwner
      ? "private, max-age=31536000, immutable"
      : "public, max-age=31536000, immutable",
    Vary: "Cookie",
    "Content-Disposition": contentDisposition(downloadFilename(image, servedFormat)),
  };

  if (variant === "original") {
    return serveOriginal(
      request,
      image.storageKey,
      contentTypeForFormat(image.format),
      baseHeaders,
    );
  }

  const key = variant === "thumb" ? storageKeys.thumb(image.id) : storageKeys.medium(image.id);

  let bytes: Buffer;
  try {
    bytes = await storage.get(key);
  } catch (error) {
    throw storageFailure(key, error);
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(bytes.byteLength),
      ...baseHeaders,
    },
  });
}

/**
 * Streams an original, honouring a single `Range` — which is how a browser
 * plays and seeks a video, and Safari will not play one at all without it.
 *
 * Derivatives don't come through here: they are small, nothing asks for part of
 * one, and buffering them keeps their path exactly as it was.
 */
async function serveOriginal(
  request: Request,
  key: string,
  contentType: string,
  baseHeaders: Record<string, string>,
): Promise<Response> {
  // If-Range asks for the range only if the client's copy is still current.
  // Nothing here sends a validator to compare against, so the safe reading is
  // that it may not be — and the answer is the whole object.
  const header = request.headers.has("If-Range") ? null : request.headers.get("Range");
  const range = header ? parseRange(header) : null;

  let opened;
  try {
    opened = await storage.open(key, range ?? undefined);
  } catch (error) {
    if (error instanceof RangeNotSatisfiable) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${error.size}`, "Accept-Ranges": "bytes" },
      });
    }
    throw storageFailure(key, error);
  }

  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    ...baseHeaders,
  };
  if (opened.range) {
    headers["Content-Range"] = `bytes ${opened.range.start}-${opened.range.end}/${opened.size}`;
    headers["Content-Length"] = String(opened.range.end - opened.range.start + 1);
  } else {
    headers["Content-Length"] = String(opened.size);
  }
  const status = opened.range ? 206 : 200;

  // The loader also answers HEAD. Handing back the body would have it read in
  // full only to be thrown away — for a bucket, a whole download per probe.
  if (request.method === "HEAD") {
    await opened.body.cancel();
    return new Response(null, { status, headers });
  }

  return new Response(opened.body, { status, headers });
}

/**
 * The Response a failed read becomes.
 *
 * The backend could not answer: wrong credentials, a bucket that stayed down
 * past the retries, a network that went away. Saying "not found" there would
 * tell the Owner their library had been deleted, and leave no trace of the real
 * cause anywhere. 503 says come back, and does not get cached.
 */
function storageFailure(key: string, error: unknown): Response {
  if (error instanceof StorageNotFound) return new Response("Not found", { status: 404 });

  console.error(`[img] could not read ${key}:`, error);
  return new Response("Image temporarily unavailable", {
    status: 503,
    headers: { "Cache-Control": "no-store" },
  });
}
