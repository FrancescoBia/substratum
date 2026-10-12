import { and, eq } from "drizzle-orm";
import { requireOwnerSession } from "~/auth/session.server";
import { db, schema } from "~/db/index.server";
import { normalizeTag, pruneOrphanTags, resolveTagId } from "~/lib/library.server";
import { storage, storageKeys } from "~/lib/storage.server";
import type { Route } from "./+types/image.$id";

/**
 * Every edit to a single Image. One endpoint with an intent rather than six
 * routes, because they all revalidate the same views and share the same guard.
 */
export async function action({ request, params }: Route.ActionArgs) {
  await requireOwnerSession(request);

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const imageId = params.id;

  switch (intent) {
    case "toggle-board": {
      const boardId = String(form.get("boardId") ?? "");
      const existing = await db
        .select()
        .from(schema.boardImages)
        .where(
          and(eq(schema.boardImages.imageId, imageId), eq(schema.boardImages.boardId, boardId)),
        );

      if (existing.length > 0) {
        await db
          .delete(schema.boardImages)
          .where(
            and(eq(schema.boardImages.imageId, imageId), eq(schema.boardImages.boardId, boardId)),
          );
      } else {
        await db
          .insert(schema.boardImages)
          .values({ boardId, imageId, addedAt: Date.now() })
          .onConflictDoNothing();
      }
      return { ok: true };
    }

    case "add-tag": {
      const name = normalizeTag(String(form.get("tag") ?? ""));
      if (!name) return { ok: false, error: "Empty tag." };

      // Tags are created the moment they're first used.
      const tagId = await resolveTagId(name);

      await db.insert(schema.imageTags).values({ imageId, tagId }).onConflictDoNothing();
      return { ok: true };
    }

    case "remove-tag": {
      const name = normalizeTag(String(form.get("tag") ?? ""));
      const [tag] = await db.select().from(schema.tags).where(eq(schema.tags.name, name));
      if (tag) {
        await db
          .delete(schema.imageTags)
          .where(and(eq(schema.imageTags.imageId, imageId), eq(schema.imageTags.tagId, tag.id)));
        await pruneOrphanTags();
      }
      return { ok: true };
    }

    // The Owner's own name, kept apart from the captured page title so a rename
    // never rewrites provenance. Blank clears it and the page title stands in
    // again.
    case "set-title": {
      const title = String(form.get("title") ?? "")
        .trim()
        .slice(0, 200);
      await db
        .update(schema.images)
        .set({ title: title || null })
        .where(eq(schema.images.id, imageId));
      return { ok: true };
    }

    // Editable because a captured URL can be wrong and an uploaded Image has
    // none at all. Blank clears it, which drops the Image back to "no source".
    case "set-source-page-url": {
      const raw = String(form.get("sourcePageUrl") ?? "").trim();
      if (raw && !isHttpUrl(raw)) {
        return { ok: false, error: "Enter an http or https URL." };
      }
      await db
        .update(schema.images)
        .set({ sourcePageUrl: raw || null })
        .where(eq(schema.images.id, imageId));
      return { ok: true };
    }

    case "set-note": {
      await db
        .update(schema.images)
        .set({ note: String(form.get("note") ?? "") })
        .where(eq(schema.images.id, imageId));
      return { ok: true };
    }

    // Trashing hides an Image from the Stream, every Board, and public serving
    // at once — it stays recoverable until it is purged.
    case "trash": {
      await db
        .update(schema.images)
        .set({ deletedAt: Date.now() })
        .where(eq(schema.images.id, imageId));
      return { ok: true };
    }

    case "restore": {
      await db.update(schema.images).set({ deletedAt: null }).where(eq(schema.images.id, imageId));
      return { ok: true };
    }

    case "purge": {
      try {
        await storage.deletePrefix(storageKeys.prefix(imageId));
      } catch (error) {
        console.error(`[purge] could not remove image ${imageId}:`, error);
        return { ok: false, error: "Couldn't delete the stored image. Try again." };
      }
      await db.delete(schema.images).where(eq(schema.images.id, imageId));
      await pruneOrphanTags();
      return { ok: true };
    }

    default:
      return { ok: false, error: `Unknown intent: ${intent}` };
  }
}

/** Same gate as ingestion uses: only http and https ever get stored. */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
