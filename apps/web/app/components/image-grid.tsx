import { Button } from "@repo/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@repo/ui/components/tooltip";
import { cn } from "cn";
import { LayoutDashboardIcon, LayoutGridIcon } from "lucide-react";
import { Link, useFetcher, useLocation, useNavigate, useRouteLoaderData } from "react-router";
import { DETAIL_PARAM, DetailPanelBody } from "~/components/detail-panel";
import { Lightbox, LIGHTBOX_PARAM, morphFromTile, useTileMorphName } from "~/components/lightbox/lightbox";
import { VideoPreview } from "~/components/video-preview";
import { TAGS_ENABLED } from "~/lib/features";
import type { GridImage } from "~/lib/library.server";
import type { loader as libraryLoader } from "~/routes/library";

export type GridLayout = "flat" | "mosaic";

/** Public Boards have no triage state, so the flag is optional here. */
type TileImage = Omit<GridImage, "untriaged"> & { untriaged?: boolean };

/**
 * Row tracks a tile spans per unit of aspect ratio. One track is 1% of a column's
 * width, so this mirrors the `/ 100` in the `mosaic` utility in `app.css` — the
 * two numbers are one decision and have to move together.
 */
const TRACKS_PER_COLUMN = 100;

/** Tracks bought to pay for the tile's own `pb-[6%]`, which is the vertical gutter. */
const GUTTER_TRACKS = 6;

/**
 * How far from square a mosaic tile may get, as height ÷ width. A panorama or a
 * long infographic would otherwise be a sliver or many screens tall, so both ends
 * are clamped and the thumbnail crops to fit — the full image is one click away in
 * the lightbox, and the flat grid crops everything to 4/5 regardless.
 */
const MIN_TILE_RATIO = 0.25;
const MAX_TILE_RATIO = 2.5;

/** A tile's shape as the mosaic will actually draw it, which is not always its own. */
function tileRatio(image: TileImage) {
  return Math.min(Math.max(image.height / image.width, MIN_TILE_RATIO), MAX_TILE_RATIO);
}

/** The row tracks a tile occupies, its own gutter included. */
function tileSpan(image: TileImage) {
  return Math.round(tileRatio(image) * TRACKS_PER_COLUMN) + GUTTER_TRACKS;
}

/** True when the shape was too extreme to draw honestly, so the thumbnail crops. */
function isClamped(image: TileImage) {
  return tileRatio(image) !== image.height / image.width;
}

/**
 * The Owner's grid or mosaic preference. It lives on the Owner row rather than in
 * the browser so the server renders the right layout from the first paint, and so
 * published Boards can follow it too.
 */
export function useGridLayout() {
  const library = useRouteLoaderData<typeof libraryLoader>("routes/library");
  // One shared key, so every view agrees while a change is still in flight.
  const fetcher = useFetcher({ key: "grid-layout" });

  const pending = fetcher.formData?.get("gridLayout");
  const layout: GridLayout =
    pending === "flat" || pending === "mosaic" ? pending : (library?.gridLayout ?? "flat");

  function changeLayout(nextLayout: GridLayout) {
    fetcher.submit({ gridLayout: nextLayout }, { method: "post", action: "/preferences" });
  }

  return [layout, changeLayout] as const;
}

/**
 * The library grid can either use uniform aspect-cropped tiles or a masonry-like
 * mosaic that preserves each thumbnail's proportions.
 *
 * A tile opens the Image full size; the corner control opens its detail panel.
 * Both are URL changes (`?view=` and `?image=`), so either state is shareable,
 * reload-stable, and closable with the back button.
 *
 * The mosaic is plain CSS Grid rather than multi-column, so tiles fill left to
 * right and DOM order is visual order — which is what lets the lightbox's ← and →
 * walk the tiles in the order the eye reads them. Each tile buys its height in row
 * tracks from its own aspect ratio; nothing is measured, so this server-renders.
 *
 * Should pagination arrive: every loaded page must render into *one* grid element.
 * Appending tiles is safe — sparse auto-placement never moves what is already
 * placed — but a grid per page would restart the packing and leave a ragged seam
 * at each page boundary.
 */
export function ImageGrid({
  images,
  layout,
  readOnly = false,
  context,
}: {
  images: TileImage[];
  layout: GridLayout;
  /** Where these images are — a Board's name, `Stream` — shown in the viewer's corner. */
  context?: string;
  /** For visitors to a published Board: no way into the Owner's detail panel. */
  readOnly?: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const library = useRouteLoaderData<typeof libraryLoader>("routes/library");
  const tileMorphName = useTileMorphName();

  // A tile opens the viewer with nothing else on: the details column is
  // something the Owner turns on from in there, not a thing every look brings.
  function viewHref(id: string) {
    const params = new URLSearchParams(location.search);
    params.delete(DETAIL_PARAM);
    params.set(LIGHTBOX_PARAM, id);
    return `${location.pathname}?${params}`;
  }

  /** The viewer's Details control — a toggle, so this both opens and closes. */
  function detailsHref(id: string) {
    const params = new URLSearchParams(location.search);
    if (params.get(DETAIL_PARAM) === id) params.delete(DETAIL_PARAM);
    else params.set(DETAIL_PARAM, id);
    const query = params.toString();
    return `${location.pathname}${query ? `?${query}` : ""}`;
  }

  function closeDetails() {
    const params = new URLSearchParams(location.search);
    params.delete(DETAIL_PARAM);
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ""}`, { preventScrollReset: true });
  }

  // The selection is loaded by the library layout, not per view, so the panel
  // works identically from the Stream, a Board and a Tag. Read from there rather
  // than threaded through three routes that have no other use for it.
  //
  // Keyed by id: the panel's fields hold local state, and remounting is what
  // resets them when the viewer steps to another Image.
  const panel =
    library && library.selected ? (
      <DetailPanelBody
        key={library.selected.id}
        image={library.selected}
        boards={library.boards}
        allTags={library.tags}
        onClose={closeDetails}
      />
    ) : null;

  // The query container the mosaic's row tracks are a percentage of. It has to be
  // an ancestor of the grid — container query units never resolve against the
  // element that declares `container-type` — and it is scoped to the mosaic
  // because `container-type` also applies layout containment, which the flat
  // grid has no reason to take on.
  return (
    <section className={layout === "mosaic" ? "@container" : undefined}>
      <div
        data-layout={layout}
        className={
          layout === "mosaic"
            ? "mosaic"
            : "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
        }
      >
        {images.map((image) => (
          <div
            key={image.id}
            // `pb-[6%]` is the vertical gutter, and `GUTTER_TRACKS` is what pays
            // for it — 6% of the tile's width is exactly 6 row tracks.
            className={cn("group relative", layout === "mosaic" && "pb-[6%]")}
            style={layout === "mosaic" ? { gridRowEnd: `span ${tileSpan(image)}` } : undefined}
          >
            {/* `viewTransition` plus the nomination below expands this tile
                into the viewer rather than cutting to it — see `morphFromTile`.
                The click handler has to run before the navigation, which is why
                it is here and not in an effect. */}
            <Link
              to={viewHref(image.id)}
              preventScrollReset
              viewTransition
              onClick={() => morphFromTile(image.id)}
              className={cn(
                "relative block rounded-lg overflow-hidden",
                layout === "mosaic" && "h-full",
              )}
              aria-label={
                image.title ?? (image.kind === "video" ? "Uploaded video" : "Uploaded image")
              }
            >
              <img
                // `medium`, not `thumb`: a tile is ~300 CSS px, so a retina
                // display wants ~600 real pixels and the 400px `thumb` was being
                // upscaled 2–3× — worst on landscape images, whose short edge is
                // what `aspect-4/5` + `object-cover` has to stretch to fill.
                // Deliberately a single candidate rather than a `srcSet`: `sizes`
                // is a static list evaluated before layout, so it cannot follow a
                // column width the Owner is free to change.
                src={`/img/${image.id}/medium`}
                alt={image.title ?? ""}
                width={image.width}
                height={image.height}
                loading="lazy"
                // The viewer looks this tile up by id on the way back, to check
                // it is still somewhere the reader can see.
                data-lightbox-tile={image.id}
                style={{ viewTransitionName: tileMorphName(image.id) }}
                // In the mosaic the tile's height already *is* the image's
                // proportions, so `object-cover` crops nothing — except on a tile
                // whose ratio was clamped, where the top is the informative end.
                className={cn(
                  "bg-muted w-full rounded-inherit outline-image object-cover transition group-hover:brightness-90",
                  layout === "mosaic" ? "h-full" : "aspect-4/5",
                  layout === "mosaic" && isClamped(image) && "object-top",
                )}
              />
              {image.kind === "video" && (
                <VideoPreview
                  id={image.id}
                  durationMs={image.durationMs}
                  className={layout === "mosaic" && isClamped(image) ? "object-top" : ""}
                />
              )}
            </Link>

            {image.untriaged && (
              <span
                className="bg-primary ring-background pointer-events-none absolute top-2 left-2 size-2 rounded-full ring-2"
                title={TAGS_ENABLED ? "Not on any board or tagged yet" : "Not on any board yet"}
              />
            )}
          </div>
        ))}
      </div>

      <Lightbox
        images={images}
        context={context}
        detailsHref={readOnly ? undefined : detailsHref}
        panel={panel}
      />
    </section>
  );
}

export function LayoutButton({
  layout,
  onLayoutChange,
}: {
  layout: GridLayout;
  onLayoutChange: (layout: GridLayout) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Grid type: ${layout === "mosaic" ? "Mosaic" : "Grid"}`}
            onClick={() => onLayoutChange(layout === "mosaic" ? "flat" : "mosaic")}
          >
            {layout === "mosaic" ? <LayoutDashboardIcon /> : <LayoutGridIcon />}
          </Button>
        }
      />
      <TooltipContent>Grid type</TooltipContent>
    </Tooltip>
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
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && (
          <p
            className="text-muted-foreground text-xs mt-3.5 font-mono"
            style={{ lineHeight: 1.55 }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </header>
  );
}
