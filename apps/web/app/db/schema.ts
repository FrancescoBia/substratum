import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Exactly one Owner per instance. Created on first run; there is no
 * sign-up flow beyond that.
 */
export const owner = sqliteTable("owner", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at").notNull(),
});

/** Server-side sessions. The cookie carries only the session id. */
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at").notNull(),
});

/**
 * One saved Image. Every save creates a row — there is no deduplication
 * anywhere, by decision, so source metadata lives inline rather than in a
 * shared source entity.
 *
 * The three source_* columns are nullable: an Image captured while browsing has
 * a source page, but one the Owner uploaded by hand does not.
 */
export const images = sqliteTable(
  "images",
  {
    id: text("id").primaryKey(),
    storageKey: text("storage_key").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    format: text("format").notNull(),
    byteSize: integer("byte_size").notNull(),
    sourceImageUrl: text("source_image_url"),
    sourcePageUrl: text("source_page_url"),
    sourcePageTitle: text("source_page_title"),
    note: text("note").notNull().default(""),
    savedAt: integer("saved_at").notNull(),
    /** Null means live; set means in the Trash, awaiting purge. */
    deletedAt: integer("deleted_at"),
  },
  (table) => [index("images_stream_idx").on(table.deletedAt, table.savedAt)],
);

/**
 * A named, curated set of Images — a view, not a container. Deleting a Board
 * removes it and its memberships; the Images live on in the Stream.
 */
export const boards = sqliteTable("boards", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /**
   * Null until first publish, then frozen: renaming a Board must never break a
   * link someone already shared.
   */
  slug: text("slug").unique(),
  published: integer("published", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
});

export const boardImages = sqliteTable(
  "board_images",
  {
    boardId: text("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    imageId: text("image_id")
      .notNull()
      .references(() => images.id, { onDelete: "cascade" }),
    addedAt: integer("added_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.boardId, table.imageId] }),
    index("board_images_image_idx").on(table.imageId),
  ],
);

/** Flat, freeform, lowercase. Always private, and only ever on Images. */
export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const imageTags = sqliteTable(
  "image_tags",
  {
    imageId: text("image_id")
      .notNull()
      .references(() => images.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.imageId, table.tagId] }),
    index("image_tags_tag_idx").on(table.tagId),
  ],
);

export type Owner = typeof owner.$inferSelect;
export type Image = typeof images.$inferSelect;
export type Board = typeof boards.$inferSelect;
export type Tag = typeof tags.$inferSelect;
