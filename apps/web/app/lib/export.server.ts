import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { ZipArchive } from "archiver";
import { asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "~/db/index.server";
import { FORMAT_EXTENSIONS } from "./download-name";
import { storage, StorageNotFound } from "./storage.server";

/**
 * Bumped if the manifest's shape ever changes, so importers can tell. 3 added
 * `kind` and `durationMs`, when Images could be videos.
 */
const MANIFEST_VERSION = 3;

type ManifestImage = {
  id: string;
  kind: "image" | "video";
  file: string;
  width: number;
  height: number;
  format: string;
  byteSize: number;
  /** Null for a still, and for a video whose container never said. */
  durationMs: number | null;
  /** The Owner's own name for the Image, or null if they never gave it one. */
  title: string | null;
  savedAt: string;
  /** Null for an Image the Owner uploaded by hand — it has no source page. */
  source: { imageUrl: string; pageUrl: string; pageTitle: string } | null;
  note: string;
  tags: string[];
  boards: string[];
};

export type Manifest = {
  manifestVersion: number;
  exportedAt: string;
  /** Trashed Images are excluded; they are on their way out, not part of the library. */
  trashedImagesExcluded: true;
  counts: { images: number; boards: number; tags: number };
  boards: Array<{ id: string; name: string; slug: string | null; published: boolean }>;
  images: ManifestImage[];
};

/**
 * Everything needed to rebuild the library elsewhere: which images exist, where
 * each came from, and how they were organized. Derivatives are left out — they
 * are regenerable from the originals.
 */
export async function buildManifest(exportedAt = new Date()): Promise<Manifest> {
  const [images, boards, boardLinks, tagLinks] = await Promise.all([
    db
      .select()
      .from(schema.images)
      .where(isNull(schema.images.deletedAt))
      .orderBy(asc(schema.images.savedAt)),
    db.select().from(schema.boards).orderBy(asc(schema.boards.name)),
    db.select().from(schema.boardImages),
    db
      .select({ imageId: schema.imageTags.imageId, name: schema.tags.name })
      .from(schema.imageTags)
      .innerJoin(schema.tags, eq(schema.tags.id, schema.imageTags.tagId)),
  ]);

  const boardNames = new Map(boards.map((board) => [board.id, board.name]));

  const boardsByImage = new Map<string, string[]>();
  for (const link of boardLinks) {
    const name = boardNames.get(link.boardId);
    if (!name) continue;
    boardsByImage.set(link.imageId, [...(boardsByImage.get(link.imageId) ?? []), name]);
  }

  const tagsByImage = new Map<string, string[]>();
  for (const link of tagLinks) {
    tagsByImage.set(link.imageId, [...(tagsByImage.get(link.imageId) ?? []), link.name]);
  }

  const tagNames = new Set(tagLinks.map((link) => link.name));

  return {
    manifestVersion: MANIFEST_VERSION,
    exportedAt: exportedAt.toISOString(),
    trashedImagesExcluded: true,
    counts: { images: images.length, boards: boards.length, tags: tagNames.size },
    boards: boards.map((board) => ({
      id: board.id,
      name: board.name,
      slug: board.slug,
      published: board.published,
    })),
    images: images.map((image) => ({
      id: image.id,
      kind: image.kind,
      file: `images/${image.id}.${FORMAT_EXTENSIONS[image.format] ?? image.format}`,
      width: image.width,
      height: image.height,
      format: image.format,
      byteSize: image.byteSize,
      durationMs: image.durationMs,
      title: image.title,
      savedAt: new Date(image.savedAt).toISOString(),
      source: image.sourcePageUrl
        ? {
            imageUrl: image.sourceImageUrl ?? "",
            pageUrl: image.sourcePageUrl,
            pageTitle: image.sourcePageTitle ?? "",
          }
        : null,
      note: image.note,
      tags: (tagsByImage.get(image.id) ?? []).sort(),
      boards: (boardsByImage.get(image.id) ?? []).sort(),
    })),
  };
}

/**
 * Streams a zip of the manifest plus every original.
 *
 * Streaming rather than buffering is the whole point: a collection built over
 * years is measured in gigabytes, and building that in memory would take down a
 * small instance. Entries are added as the archive drains.
 */
export function createExportArchive(manifest: Manifest): Readable {
  const archive = new ZipArchive({
    // Images are already compressed; recompressing them costs CPU and saves
    // almost nothing. The manifest is small enough that it doesn't matter.
    zlib: { level: 0 },
  });

  // The caller turns this into a response body and handles the error there. This
  // listener only guarantees there is always one: an `error` with no listener at
  // all takes the process down, and the loop below can destroy the stream before
  // the caller has had a chance to attach.
  archive.on("error", () => {});

  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });

  void (async () => {
    try {
      for (const image of manifest.images) {
        const [row] = await db
          .select({ storageKey: schema.images.storageKey })
          .from(schema.images)
          .where(eq(schema.images.id, image.id));
        if (!row) continue;

        let opened;
        try {
          opened = await storage.open(row.storageKey);
        } catch (error) {
          // A file that is genuinely gone shouldn't abort the whole export —
          // the manifest still records that the image existed.
          if (!(error instanceof StorageNotFound)) throw error;
          console.error(`[export] skipped missing ${image.id}:`, error);
          continue;
        }

        // One original in flight at a time. The archive takes entries in order
        // and only reads this one once the last has gone out, so opening the
        // next before this has drained would hold every file — or, against a
        // bucket, every connection — open at once. (The cast bridges the DOM
        // and Node typings of the same runtime class.)
        const source = Readable.fromWeb(opened.body as NodeReadableStream<Uint8Array>);
        archive.append(source, { name: image.file });

        // A download abandoned partway closes the archive, which then never
        // reads this source — so it is released here rather than waited on for
        // ever. `finished` then rejects, and the export ends below.
        const abandon = () => source.destroy();
        archive.once("close", abandon);
        try {
          await finished(source);
        } finally {
          archive.off("close", abandon);
        }
      }

      await archive.finalize();
    } catch (error) {
      // The backend stopped answering partway through. Finalising here would
      // hand the Owner a zip whose manifest lists images the archive does not
      // contain, and the only sign of it would be a line in the container log.
      //
      // `destroy` rather than `abort`: abort shuts the queue down and ends the
      // stream cleanly, which is the same silently-short download by another
      // route. Destroying with an error fails the transfer instead — and since
      // a zip's central directory is only written at finalize, what arrived is
      // not a readable archive either. Both say the same thing, which is: run it
      // again.
      console.error("[export] aborted:", error);
      archive.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  })();

  return archive as unknown as Readable;
}
