import { getOwner } from "~/auth/session.server";
import { EmptyState, ImageGrid, ViewHeader } from "~/components/image-grid";
import { skipLightboxRevalidation } from "~/components/lightbox";
import { instanceUrlFor } from "~/lib/config.server";
import { getPublishedBoard, listPublicBoardImages } from "~/lib/library.server";
import { countLabel } from "~/lib/media";
import type { Route } from "./+types/board.$slug";

// Opening the full-size viewer is only a `?view=` change, and this loader never
// reads it. Without this, stepping through the board would re-fetch it per image.
export const shouldRevalidate = skipLightboxRevalidation;

/**
 * `meta` runs on the client as well as the server, so it cannot reach into
 * config.server for the instance URL — absolute URLs are built in the loader and
 * passed through instead.
 */
export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Board not found · Substratum" }];

  const { board, images, canonical, ogImage } = loaderData;
  const description = `A collection of ${countLabel(images)} on Substratum.`;

  return [
    { title: `${board.name} · Substratum` },
    { name: "description", content: description },
    // These pages exist to be shared, so they should unfurl properly.
    { property: "og:type", content: "website" },
    { property: "og:title", content: board.name },
    { property: "og:description", content: description },
    { property: "og:url", content: canonical },
    ...(ogImage ? [{ property: "og:image", content: ogImage }] : []),
    { name: "twitter:card", content: ogImage ? "summary_large_image" : "summary" },
  ];
}

/**
 * A published Board, served to anyone. No session, no sidebar, and nothing from
 * the rest of the library: only this board's images and where each was found.
 * Tags and notes stay private.
 */
export async function loader({ params, request }: Route.LoaderArgs) {
  const board = await getPublishedBoard(params.slug);

  // Unpublished, never published, or no such board all look the same from
  // outside — unpublishing takes the page down, it doesn't leave a signpost.
  if (!board) throw new Response("Not found", { status: 404 });

  const [images, owner] = await Promise.all([listPublicBoardImages(board.id), getOwner()]);
  const origin = instanceUrlFor(request);

  return {
    board,
    images,
    gridLayout: owner?.gridLayout ?? "flat",
    canonical: `${origin}/board/${board.slug}`,
    ogImage: images[0] ? `${origin}/img/${images[0].id}/medium` : null,
  };
}

export default function PublicBoard({ loaderData }: Route.ComponentProps) {
  const { board, images, gridLayout } = loaderData;

  return (
    <main className="mx-auto max-w-7xl px-6 pt-10 pb-24">
      <ViewHeader title={board.name} subtitle={countLabel(images)} />

      {images.length === 0 ? (
        <EmptyState title="Nothing on this board yet" />
      ) : (
        <ImageGrid images={images} layout={gridLayout} readOnly />
      )}

      <footer className="text-muted-foreground mt-16 border-t pt-6 text-xs">
        Collected with{" "}
        <a href="https://github.com/FrancescoBia/substratum" className="underline">
          Substratum
        </a>
      </footer>
    </main>
  );
}
