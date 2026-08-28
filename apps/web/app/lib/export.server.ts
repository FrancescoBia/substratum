import { Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "~/db/index.server";
import { storage } from "./storage.server";

/** Bumped if the manifest's shape ever changes, so importers can tell. */
const MANIFEST_VERSION = 1;

const EXTENSIONS: Record<string, string> = {
  jpeg: "jpg",
  png: "png",
  gif: "gif",
  webp: "webp",
  avif: "avif",
};

type ManifestImage = {
  id: string;
  file: string;
  width: number;
  height: number;
  format: string;
  byteSize: number;
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
      file: `images/${image.id}.${EXTENSIONS[image.format] ?? image.format}`,
      width: image.width,
      height: image.height,
      format: image.format,
      byteSize: image.byteSize,
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

  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });

  void (async () => {
    for (const image of manifest.images) {
      try {
        const [row] = await db
          .select({ storageKey: schema.images.storageKey })
          .from(schema.images)
          .where(eq(schema.images.id, image.id));
        if (!row) continue;

        archive.append(await storage.get(row.storageKey), { name: image.file });
      } catch (error) {
        // A missing file shouldn't abort the whole export — the manifest still
        // records that the image existed.
        console.error(`[export] skipped ${image.id}:`, error);
      }
    }

    await archive.finalize();
  })();

  return archive as unknown as Readable;
}
