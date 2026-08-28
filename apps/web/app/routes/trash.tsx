import { RotateCcw, X } from "lucide-react";
import { useFetcher } from "react-router";
import { EmptyState, ViewHeader } from "~/components/image-grid";
import { Button } from "~/components/ui/button";
import { requireOwnerSession } from "~/auth/session.server";
import { listTrash } from "~/lib/library.server";
import type { Route } from "./+types/trash";

export function meta() {
  return [{ title: "Trash · Substratum" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireOwnerSession(request);
  return { images: await listTrash() };
}

/**
 * Trashed Images are already gone from the Stream, every Board, and public
 * serving — this is only about recovering them or letting them go for good.
 * Anything left past the retention window is purged by the sweep in
 * `purge.server.ts` without the Owner having to come here.
 */
export default function Trash({ loaderData }: Route.ComponentProps) {
  const { images } = loaderData;
  const act = useFetcher();

  return (
    <div className="p-6">
      <ViewHeader
        title="Trash"
        subtitle={
          images.length === 0
            ? "Empty"
            : `${images.length} image${images.length === 1 ? "" : "s"} · recoverable until purged`
        }
      />

      {images.length === 0 ? (
        <EmptyState title="Nothing in the Trash" />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {images.map((image) => (
            <div key={image.id} className="group relative">
              <img
                src={`/img/${image.id}/thumb`}
                alt={image.title ?? ""}
                loading="lazy"
                className="bg-muted aspect-4/5 w-full rounded-lg object-cover opacity-60"
              />
              <div className="absolute inset-x-1 bottom-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 flex-1"
                  onClick={() =>
                    act.submit({ intent: "restore" }, { method: "post", action: `/image/${image.id}` })
                  }
                >
                  <RotateCcw className="size-3" /> Restore
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="text-destructive h-7"
                  title="Delete permanently"
                  onClick={() => {
                    if (confirm("Delete this image permanently? This cannot be undone.")) {
                      act.submit(
                        { intent: "purge" },
                        { method: "post", action: `/image/${image.id}` },
                      );
                    }
                  }}
                >
                  <X className="size-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
