import { ExternalLink } from "lucide-react";
import { instanceUrl } from "~/lib/config.server";
import { getPublishedBoard, listPublicBoardImages } from "~/lib/library.server";
import type { Route } from "./+types/board.$slug";

/**
 * `meta` runs on the client as well as the server, so it cannot reach into
 * config.server for the instance URL — absolute URLs are built in the loader and
 * passed through instead.
 */
export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Board not found · Substratum" }];

  const { board, images, canonical, ogImage } = loaderData;
  const description = `A collection of ${images.length} image${
    images.length === 1 ? "" : "s"
  } on Substratum.`;

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
export async function loader({ params }: Route.LoaderArgs) {
  const board = await getPublishedBoard(params.slug);

  // Unpublished, never published, or no such board all look the same from
  // outside — unpublishing takes the page down, it doesn't leave a signpost.
  if (!board) throw new Response("Not found", { status: 404 });

  const images = await listPublicBoardImages(board.id);

  return {
    board,
    images,
    canonical: `${instanceUrl}/board/${board.slug}`,
    ogImage: images[0] ? `${instanceUrl}/img/${images[0].id}/medium` : null,
  };
}

export default function PublicBoard({ loaderData }: Route.ComponentProps) {
  const { board, images } = loaderData;

  return (
    <main className="mx-auto max-w-7xl px-6 pb-24">
      <header className="py-10">
        <h1 className="text-3xl font-semibold tracking-tight">{board.name}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {images.length} image{images.length === 1 ? "" : "s"}
        </p>
      </header>

      {images.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed p-12 text-center text-sm">
          Nothing on this board yet.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((image) => (
            <figure key={image.id}>
              <img
                src={`/img/${image.id}/thumb`}
                alt={image.sourcePageTitle ?? ""}
                width={image.width}
                height={image.height}
                loading="lazy"
                className="bg-muted aspect-4/5 w-full rounded-lg object-cover"
              />
              {/* Attribution only where there is something to attribute — an
                  uploaded image has no source page. */}
              {image.sourcePageUrl && (
                <figcaption className="mt-1.5 truncate text-xs">
                  <a
                    href={image.sourcePageUrl}
                    target="_blank"
                    rel="noreferrer nofollow"
                    className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 hover:underline"
                  >
                    {hostOf(image.sourcePageUrl)}
                    <ExternalLink className="size-3 shrink-0" />
                  </a>
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      )}

      <footer className="text-muted-foreground mt-16 border-t pt-6 text-xs">
        Collected with <a href="https://github.com/FrancescoBia/substratum" className="underline">Substratum</a>
      </footer>
    </main>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
