import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "~/db/index.server";
// Imported for its side effect: loading this module starts the Trash purge
// sweeps. Every library view goes through here, so the sweeps start with the
// first request rather than needing a separate entry point.
import "./purge.server";

export type GridImage = {
  id: string;
  width: number;
  height: number;
  title: string | null;
  sourcePageUrl: string | null;
  untriaged: boolean;
};

/**
 * An Image is untriaged when it has no Boards and no Tags — it arrived and
 * nobody has filed it yet. That set is the inbox triage mode works through.
 */
async function organizedImageIds(): Promise<Set<string>> {
  const [onBoards, tagged] = await Promise.all([
    db.selectDistinct({ id: schema.boardImages.imageId }).from(schema.boardImages),
    db.selectDistinct({ id: schema.imageTags.imageId }).from(schema.imageTags),
  ]);
  return new Set([...onBoards, ...tagged].map((row) => row.id));
}

function toGridImages(
  rows: Array<{
    id: string;
    width: number;
    height: number;
    sourcePageTitle: string | null;
    sourcePageUrl: string | null;
  }>,
  organized: Set<string>,
): GridImage[] {
  return rows.map((row) => ({
    id: row.id,
    width: row.width,
    height: row.height,
    title: row.sourcePageTitle,
    sourcePageUrl: row.sourcePageUrl,
    untriaged: !organized.has(row.id),
  }));
}

const gridColumns = {
  id: schema.images.id,
  width: schema.images.width,
  height: schema.images.height,
  sourcePageTitle: schema.images.sourcePageTitle,
  sourcePageUrl: schema.images.sourcePageUrl,
};

/** Every live Image, newest first. */
export async function listStream(): Promise<GridImage[]> {
  const [rows, organized] = await Promise.all([
    db
      .select(gridColumns)
      .from(schema.images)
      .where(isNull(schema.images.deletedAt))
      .orderBy(desc(schema.images.savedAt)),
    organizedImageIds(),
  ]);
  return toGridImages(rows, organized);
}

export async function listBoardImages(boardId: string): Promise<GridImage[]> {
  const [rows, organized] = await Promise.all([
    db
      .select(gridColumns)
      .from(schema.images)
      .innerJoin(schema.boardImages, eq(schema.boardImages.imageId, schema.images.id))
      .where(and(eq(schema.boardImages.boardId, boardId), isNull(schema.images.deletedAt)))
      .orderBy(desc(schema.boardImages.addedAt)),
    organizedImageIds(),
  ]);
  return toGridImages(rows, organized);
}

export async function listTagImages(tagName: string): Promise<GridImage[]> {
  const [rows, organized] = await Promise.all([
    db
      .select(gridColumns)
      .from(schema.images)
      .innerJoin(schema.imageTags, eq(schema.imageTags.imageId, schema.images.id))
      .innerJoin(schema.tags, eq(schema.tags.id, schema.imageTags.tagId))
      .where(and(eq(schema.tags.name, tagName), isNull(schema.images.deletedAt)))
      .orderBy(desc(schema.images.savedAt)),
    organizedImageIds(),
  ]);
  return toGridImages(rows, organized);
}

export async function listTrash(): Promise<GridImage[]> {
  const rows = await db
    .select(gridColumns)
    .from(schema.images)
    .where(isNotNull(schema.images.deletedAt))
    .orderBy(desc(schema.images.deletedAt));
  return toGridImages(rows, new Set());
}

/** Untriaged Images, oldest first — the inbox is worked front to back. */
export async function listUntriaged(): Promise<GridImage[]> {
  const stream = await listStream();
  return stream.filter((image) => image.untriaged).reverse();
}

/**
 * Counts exclude trashed Images, so the sidebar never promises more than a view
 * will show. Expressed as a grouped join rather than a correlated subquery — the
 * latter silently returned zero.
 */
export async function listBoards() {
  return db
    .select({
      id: schema.boards.id,
      name: schema.boards.name,
      slug: schema.boards.slug,
      published: schema.boards.published,
      count: count(schema.images.id),
    })
    .from(schema.boards)
    .leftJoin(schema.boardImages, eq(schema.boardImages.boardId, schema.boards.id))
    .leftJoin(
      schema.images,
      and(eq(schema.images.id, schema.boardImages.imageId), isNull(schema.images.deletedAt)),
    )
    .groupBy(schema.boards.id)
    .orderBy(schema.boards.name);
}

export async function listTags() {
  return db
    .select({
      id: schema.tags.id,
      name: schema.tags.name,
      count: count(schema.images.id),
    })
    .from(schema.tags)
    .leftJoin(schema.imageTags, eq(schema.imageTags.tagId, schema.tags.id))
    .leftJoin(
      schema.images,
      and(eq(schema.images.id, schema.imageTags.imageId), isNull(schema.images.deletedAt)),
    )
    .groupBy(schema.tags.id)
    .orderBy(schema.tags.name);
}

/** Everything the detail panel needs for one Image. */
export async function getImageDetail(id: string) {
  const [image] = await db.select().from(schema.images).where(eq(schema.images.id, id));
  if (!image) return null;

  const [boardIds, tagNames] = await Promise.all([
    db
      .select({ boardId: schema.boardImages.boardId })
      .from(schema.boardImages)
      .where(eq(schema.boardImages.imageId, id)),
    db
      .select({ name: schema.tags.name })
      .from(schema.imageTags)
      .innerJoin(schema.tags, eq(schema.tags.id, schema.imageTags.tagId))
      .where(eq(schema.imageTags.imageId, id)),
  ]);

  return {
    id: image.id,
    width: image.width,
    height: image.height,
    format: image.format,
    byteSize: image.byteSize,
    note: image.note,
    savedAt: image.savedAt,
    deletedAt: image.deletedAt,
    sourceImageUrl: image.sourceImageUrl,
    sourcePageUrl: image.sourcePageUrl,
    sourcePageTitle: image.sourcePageTitle,
    boardIds: boardIds.map((row) => row.boardId),
    tags: tagNames.map((row) => row.name),
  };
}

export type ImageDetail = NonNullable<Awaited<ReturnType<typeof getImageDetail>>>;

/** A published Board by its frozen slug, or null. Unpublished ones are invisible. */
export async function getPublishedBoard(slug: string) {
  const [board] = await db
    .select({ id: schema.boards.id, name: schema.boards.name, slug: schema.boards.slug })
    .from(schema.boards)
    .where(and(eq(schema.boards.slug, slug), eq(schema.boards.published, true)));

  return board ?? null;
}

/**
 * What a visitor to a published Board may see: the images and where each came
 * from. No tags, no notes — those are the Owner's private annotations.
 */
export async function listPublicBoardImages(boardId: string) {
  return db
    .select({
      id: schema.images.id,
      width: schema.images.width,
      height: schema.images.height,
      sourcePageUrl: schema.images.sourcePageUrl,
      sourcePageTitle: schema.images.sourcePageTitle,
    })
    .from(schema.images)
    .innerJoin(schema.boardImages, eq(schema.boardImages.imageId, schema.images.id))
    .where(and(eq(schema.boardImages.boardId, boardId), isNull(schema.images.deletedAt)))
    .orderBy(desc(schema.boardImages.addedAt));
}

/**
 * Whether an Image may be served to someone without a session — true only while
 * it is live and sits on at least one published Board. This is the gate that
 * lets public board pages render without exposing the whole library.
 */
export async function isPubliclyVisible(imageId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.images.id })
    .from(schema.images)
    .innerJoin(schema.boardImages, eq(schema.boardImages.imageId, schema.images.id))
    .innerJoin(schema.boards, eq(schema.boards.id, schema.boardImages.boardId))
    .where(
      and(
        eq(schema.images.id, imageId),
        isNull(schema.images.deletedAt),
        eq(schema.boards.published, true),
      ),
    )
    .limit(1);

  return row !== undefined;
}

/** Tags are flat and lowercase; normalizing here keeps that true everywhere. */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 40);
}

/**
 * The id of a Tag by name, creating it if this is its first use — Tags have no
 * lifecycle of their own beyond the Images that carry them.
 */
export async function resolveTagId(name: string): Promise<string> {
  const [existing] = await db.select().from(schema.tags).where(eq(schema.tags.name, name));
  if (existing) return existing.id;

  await db.insert(schema.tags).values({ id: randomUUID(), name }).onConflictDoNothing();
  const [tag] = await db.select().from(schema.tags).where(eq(schema.tags.name, name));
  return tag.id;
}

/** Drops Tags nothing points at any more, so the sidebar doesn't accumulate cruft. */
export async function pruneOrphanTags() {
  const orphans = await db
    .select({ id: schema.tags.id })
    .from(schema.tags)
    .where(sql`not exists (select 1 from image_tags where tag_id = ${schema.tags.id})`);

  if (orphans.length > 0) {
    await db.delete(schema.tags).where(
      inArray(
        schema.tags.id,
        orphans.map((row) => row.id),
      ),
    );
  }
}
