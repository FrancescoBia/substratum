import { Readable } from "node:stream";
import { requireOwnerSession } from "~/auth/session.server";
import { buildManifest, createExportArchive } from "~/lib/export.server";
import type { Route } from "./+types/export";

/** substratum-export-2026-07-31.zip */
function filenameFor(date: Date): string {
  return `substratum-export-${date.toISOString().slice(0, 10)}.zip`;
}

/**
 * The whole library as a zip: originals plus a manifest describing them. This is
 * the no-lock-in guarantee — not a backup, which is the volume's job.
 *
 * A GET so the browser can download it directly, which is safe because nothing
 * here mutates.
 */
export async function loader({ request }: Route.LoaderArgs) {
  await requireOwnerSession(request);

  const exportedAt = new Date();
  const manifest = await buildManifest(exportedAt);
  const archive = createExportArchive(manifest);

  // No Content-Length: the size isn't known until the archive is built, and
  // buffering it to find out would defeat streaming.
  return new Response(Readable.toWeb(archive) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filenameFor(exportedAt)}"`,
      "Cache-Control": "no-store",
    },
  });
}
