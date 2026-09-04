import { Info, LayoutDashboard, LayoutGrid } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { Lightbox, LIGHTBOX_PARAM } from "~/components/lightbox";
import { Button } from "~/components/ui/button";
import type { GridImage } from "~/lib/library.server";

type GridLayout = "flat" | "mosaic";

const GRID_LAYOUT_STORAGE_KEY = "substratum-grid-layout";

/**
 * The library grid can either use uniform aspect-cropped tiles or a masonry-like
 * mosaic that preserves each thumbnail's proportions.
 *
 * A tile opens the Image full size; the corner control opens its detail panel.
 * Both are URL changes (`?view=` and `?image=`), so either state is shareable,
 * reload-stable, and closable with the back button.
 */
export function ImageGrid({
  images,
  allowLayoutSwitch = false,
}: {
  images: GridImage[];
  allowLayoutSwitch?: boolean;
}) {
  const location = useLocation();
  const [layout, setLayout] = useState<GridLayout>("flat");

  useEffect(() => {
    try {
      if (window.localStorage.getItem(GRID_LAYOUT_STORAGE_KEY) === "mosaic") {
        setLayout("mosaic");
      }
    } catch {
      // Storage can be unavailable in privacy-restricted browsers. The switch
      // still works for the current page in that case.
    }
  }, []);

  function changeLayout(nextLayout: GridLayout) {
    setLayout(nextLayout);
    try {
      window.localStorage.setItem(GRID_LAYOUT_STORAGE_KEY, nextLayout);
    } catch {
      // Keep the in-memory preference when persistence is unavailable.
    }
  }

  // The two surfaces are mutually exclusive, so each link clears the other's
  // param rather than leaving a stale one behind in a shared URL.
  function viewHref(id: string) {
    const params = new URLSearchParams(location.search);
    params.delete("image");
    params.set(LIGHTBOX_PARAM, id);
    return `${location.pathname}?${params}`;
  }

  function detailsHref(id: string) {
    const params = new URLSearchParams(location.search);
    params.delete(LIGHTBOX_PARAM);
    params.set("image", id);
    return `${location.pathname}?${params}`;
  }

  return (
    <section>
      {allowLayoutSwitch && (
        <div className="mb-3 flex justify-end">
          <div
            role="group"
            aria-label="Image layout"
            className="bg-muted flex items-center gap-0.5 rounded-lg p-0.5"
          >
            <Button
              type="button"
              variant={layout === "flat" ? "secondary" : "ghost"}
              size="icon-sm"
              aria-pressed={layout === "flat"}
              onClick={() => changeLayout("flat")}
              title="Flat grid"
              className={layout === "flat" ? "bg-background shadow-sm hover:bg-background" : ""}
            >
              <LayoutGrid />
              <span className="sr-only">Flat grid</span>
            </Button>
            <Button
              type="button"
              variant={layout === "mosaic" ? "secondary" : "ghost"}
              size="icon-sm"
              aria-pressed={layout === "mosaic"}
              onClick={() => changeLayout("mosaic")}
              title="Mosaic"
              className={layout === "mosaic" ? "bg-background shadow-sm hover:bg-background" : ""}
            >
              <LayoutDashboard />
              <span className="sr-only">Mosaic</span>
            </Button>
          </div>
        </div>
      )}

      <div
        data-layout={layout}
        className={
          layout === "mosaic"
            ? "columns-2 gap-3 sm:columns-3 lg:columns-4 xl:columns-5"
            : "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
        }
      >
        {images.map((image) => (
          <div
            key={image.id}
            className={
              layout === "mosaic" ? "group relative mb-3 break-inside-avoid" : "group relative"
            }
          >
            <Link
              to={viewHref(image.id)}
              preventScrollReset
              className="block"
              aria-label={image.title ?? "Uploaded image"}
            >
              <img
                src={`/img/${image.id}/thumb`}
                alt={image.title ?? ""}
                width={image.width}
                height={image.height}
                loading="lazy"
                className={`bg-muted w-full rounded-lg object-cover transition group-hover:brightness-90 ${
                  layout === "mosaic" ? "h-auto" : "aspect-4/5"
                }`}
              />
            </Link>

            {/* A sibling of the tile link rather than a child: nesting one link
                inside another is invalid, and the panel is a different place to
                go than the full-size view. */}
            <Link
              to={detailsHref(image.id)}
              preventScrollReset
              title="Details"
              className="absolute top-2 right-2 inline-flex size-7 items-center justify-center rounded-lg bg-black/50 text-white/80 opacity-0 transition group-hover:opacity-100 hover:bg-black/70 hover:text-white focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
            >
              <Info className="size-4" />
              <span className="sr-only">Details for {image.title ?? "this image"}</span>
            </Link>

            {image.untriaged && (
              <span
                className="bg-primary ring-background pointer-events-none absolute top-2 left-2 size-2 rounded-full ring-2"
                title="Not on any board or tagged yet"
              />
            )}
          </div>
        ))}
      </div>

      <Lightbox images={images} detailsHref={detailsHref} />
    </section>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed p-12 text-center">
      <h2 className="font-medium">{title}</h2>
      {children && (
        <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">{children}</p>
      )}
    </div>
  );
}

export function ViewHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-4 pb-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-muted-foreground text-sm">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </header>
  );
}
