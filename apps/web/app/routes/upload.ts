import { readFile } from "node:fs/promises";
import { MAX_IMAGE_BYTES } from "@repo/shared";
import { eq } from "drizzle-orm";
import { requireOwnerSession } from "~/auth/session.server";
import { db, schema } from "~/db/index.server";
import { ingestImage, ingestVideo, type IngestResult } from "~/lib/ingest.server";
import { normalizeTag, resolveTagId } from "~/lib/library.server";
import { sniffMedia } from "~/lib/media-sniff";
import {
  discardSpooled,
  readHead,
  receiveUpload,
  UploadUnreadable,
  type ReceivedUpload,
  type SpooledFile,
} from "~/lib/upload.server";
import type { Route } from "./+types/upload";

export type UploadResult = { uploaded: number; errors: string[] };

/**
 * Manual upload — the path that makes Substratum usable without the extension.
 * Takes images and videos alike; what each file is comes from its bytes.
 *
 * Its own route rather than an action on the Stream: a POST to "/" would target
 * the root layout route unless disambiguated with `?index`, and an explicit
 * endpoint is easier to reason about and to test.
 */
export async function action({ request }: Route.ActionArgs): Promise<UploadResult> {
  await requireOwnerSession(request);

  let upload: ReceivedUpload;
  try {
    upload = await receiveUpload(request);
  } catch (error) {
    if (error instanceof UploadUnreadable) return { uploaded: 0, errors: [error.message] };
    throw error;
  }

  try {
    return await ingestAll(upload);
  } finally {
    await discardSpooled(upload.files);
  }
}

async function ingestAll({ fields, files }: ReceivedUpload): Promise<UploadResult> {
  const boardId = fields.get("boardId") ?? "";
  const tagName = normalizeTag(fields.get("tag") ?? "");

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
      const result = await ingestSpooled(file);
      return result.ok
        ? { id: result.id, error: null }
        : { id: null, error: `${file.name}: ${result.message}` };
    }),
  );

  const errors = results
    .map((result) => result.error)
    .filter((message): message is string => message !== null);
  const imageIds = results.map((result) => result.id).filter((id): id is string => id !== null);

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

/** Sends one spooled file down the image or video path, by what its bytes say it is. */
async function ingestSpooled(file: SpooledFile): Promise<IngestResult> {
  const sniffed = sniffMedia(await readHead(file.path));

  if (sniffed.kind === "unsupported-video") {
    return {
      ok: false,
      code: "unsupported-format",
      message: `${sniffed.container} videos aren't supported — export it as MP4 or WebM to save it.`,
    };
  }

  if (sniffed.kind === "video") {
    return ingestVideo(file.path, file.size, sniffed.container, null);
  }

  // Stills are small enough to take into memory, as they always have been —
  // but a 90 MB file that only claims to be one is refused before it is read.
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, code: "too-large", message: "That image is larger than 50 MB." };
  }
  return ingestImage(await readFile(file.path), null);
}
