import { eq } from "drizzle-orm";
import { requireOwnerSession } from "~/auth/session.server";
import { db, schema } from "~/db/index.server";
import { ingestImage } from "~/lib/ingest.server";
import { normalizeTag, resolveTagId } from "~/lib/library.server";
import type { Route } from "./+types/upload";

export type UploadResult = { uploaded: number; errors: string[] };

/**
 * Manual upload — the path that makes Substratum usable without the extension.
 *
 * Its own route rather than an action on the Stream: a POST to "/" would target
 * the root layout route unless disambiguated with `?index`, and an explicit
 * endpoint is easier to reason about and to test.
 */
export async function action({ request }: Route.ActionArgs): Promise<UploadResult> {
  await requireOwnerSession(request);

  const form = await request.formData();
  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
  const boardId = String(form.get("boardId") ?? "");
  const tagName = normalizeTag(String(form.get("tag") ?? ""));

  if (files.length === 0) {
    return { uploaded: 0, errors: ["No files were selected."] };
  }

  if (boardId) {
    const [board] = await db
      .select({ id: schema.boards.id })
      .from(schema.boards)
      .where(eq(schema.boards.id, boardId));
    if (!board) return { uploaded: 0, errors: ["That board no longer exists."] };
  }

  // Uploaded by hand, so there is no source page — these ingest with a null
  // source rather than a fabricated one.
  const results = await Promise.all(
    files.map(async (file) => {
      const bytes = Buffer.from(await file.arrayBuffer());
      const result = await ingestImage(bytes, null);
      return result.ok
        ? { id: result.id, error: null }
        : { id: null, error: `${file.name || "image"}: ${result.message}` };
    }),
  );

  const errors = results
    .map((result) => result.error)
    .filter((message): message is string => message !== null);
  const imageIds = results
    .map((result) => result.id)
    .filter((id): id is string => id !== null);

  if (boardId && imageIds.length > 0) {
    const addedAt = Date.now();
    await db
      .insert(schema.boardImages)
      .values(imageIds.map((imageId) => ({ boardId, imageId, addedAt })));
  }

  // Unlike a Board, a Tag needs no existence check: it is created on first use,
  // so dropping onto one the last Image just vacated brings it back.
  if (tagName && imageIds.length > 0) {
    const tagId = await resolveTagId(tagName);
    await db.insert(schema.imageTags).values(imageIds.map((imageId) => ({ imageId, tagId })));
  }

  return { uploaded: files.length - errors.length, errors };
}
