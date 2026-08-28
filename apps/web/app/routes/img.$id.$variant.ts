import { eq } from "drizzle-orm";
import { getOwnerFromSession } from "~/auth/session.server";
import { db, schema } from "~/db/index.server";
import { isPubliclyVisible } from "~/lib/library.server";
import { storage, storageKeys, type Variant } from "~/lib/storage.server";
import type { Route } from "./+types/img.$id.$variant";

const CONTENT_TYPES: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
};

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

  const key =
    variant === "original"
      ? image.storageKey
      : variant === "thumb"
        ? storageKeys.thumb(image.id)
        : storageKeys.medium(image.id);

  let bytes: Buffer;
  try {
    bytes = await storage.get(key);
  } catch {
    throw new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type":
        variant === "original"
          ? (CONTENT_TYPES[image.format] ?? "application/octet-stream")
          : "image/webp",
      "Content-Length": String(bytes.byteLength),
      // Stored bytes never change for a given id, so this caches hard. Public
      // responses may sit in shared caches; the Owner's must not, since the same
      // URL 404s for everyone else.
      "Cache-Control": isOwner
        ? "private, max-age=31536000, immutable"
        : "public, max-age=31536000, immutable",
      Vary: "Cookie",
    },
  });
}
