import { requireOwnerSession } from "~/auth/session.server";
import { ingestImage } from "~/lib/ingest.server";
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

  if (files.length === 0) {
    return { uploaded: 0, errors: ["No files were selected."] };
  }

  // Uploaded by hand, so there is no source page — these ingest with a null
  // source rather than a fabricated one.
  const results = await Promise.all(
    files.map(async (file) => {
      const bytes = Buffer.from(await file.arrayBuffer());
      const result = await ingestImage(bytes, null);
      return result.ok ? null : `${file.name || "image"}: ${result.message}`;
    }),
  );

  const errors = results.filter((message): message is string => message !== null);
  return { uploaded: files.length - errors.length, errors };
}
