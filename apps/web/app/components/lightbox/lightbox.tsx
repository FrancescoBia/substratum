import { cn } from "cn";
import { ArrowLeftIcon, ArrowRightIcon, InfoIcon, XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { DETAIL_PARAM } from "~/components/detail-panel";
import { fullSizeSrcSet } from "~/lib/image-variants";
import { formatBytes, formatDuration } from "~/lib/media";
import { isTileOnScreen, MORPH_NAME, morphFromTile, useMorphTarget } from "./morph";
import { blurStrip, MotionBlurFilter } from "./motion-blur";
import { LIGHTBOX_PARAM } from "./routing";
import { placeStrip, slotSize, stripWindow } from "./strip-geometry";
import { useStripSpring } from "./use-strip-spring";

export type LightboxImage = {
  id: string;
  kind: "image" | "video";
  width: number;
  height: number;
  durationMs: number | null;
  format: string;
  byteSize: number;
  title: string | null;
  sourcePageUrl: string | null;
};

const CONTROL =
  "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring inline-flex items-center justify-center gap-1.5 rounded-full outline-none transition focus-visible:ring-2";

/**
 * The full-size viewer: one Image on a plain surface, above whatever grid opened
 * it. The grid supplies the whole list it is showing, so ← and → walk the same
 * set in the same order the tiles are in.
 */
export function Lightbox({
  images,
  context,
  detailsHref,
  panel,
}: {
  images: LightboxImage[];
  /** Where the images are — a Board's name, `Stream` — shown top left. */
  context?: string;
  /** When set, a "Details" control appears — the Owner's way to the panel. */
  detailsHref?: (id: string) => string;
  /**
   * The details column, when the Owner has asked for it. Rendered inside this
   * dialog rather than as a sheet of its own, so there is one backdrop, one
   * focus trap, and the Image stays visible next to what edits it.
   */
  panel?: React.ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const openId = searchParams.get(LIGHTBOX_PARAM);
  const index = openId ? images.findIndex((image) => image.id === openId) : -1;
  const image = index === -1 ? null : images[index];

  const close = useCallback(() => {
    morphFromTile(openId && isTileOnScreen(openId) ? openId : null);

    const params = new URLSearchParams(location.search);
    params.delete(LIGHTBOX_PARAM);
    // The panel lives inside this dialog, so it cannot outlive it — a stray
    // `?image=` would otherwise keep the layout loading a selection nothing
    // renders.
    params.delete(DETAIL_PARAM);
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ""}`, {
      preventScrollReset: true,
      viewTransition: true,
    });
  }, [location.pathname, location.search, navigate, openId]);

  // Where the last step was *aimed*, which is not always where the URL has got
  // to yet: held or hammered arrow keys land several presses before the first
  // navigation commits, and stepping from the rendered index would make them all
  // move the same single place. Only the ref compounds.
  const intendedId = useRef(openId);
  useEffect(() => {
    intendedId.current = openId;
  }, [openId]);

  // Stops at either end rather than wrapping round. Stepping `replace`s rather
  // than pushes, so however far you walk, one Escape or one Back returns to the
  // grid instead of unwinding the whole visit.
  const step = useCallback(
    (delta: number) => {
      const from = images.findIndex((image) => image.id === intendedId.current);
      if (from === -1) return;

      const to = from + delta;
      if (to < 0 || to >= images.length) return;
      const next = images[to];
      intendedId.current = next.id;

      // The panel follows the viewer: if it is open, it has to be open on the
      // Image now on screen, not the one stepped away from.
      const params = new URLSearchParams(location.search);
      params.set(LIGHTBOX_PARAM, next.id);
      if (params.has(DETAIL_PARAM)) params.set(DETAIL_PARAM, next.id);

      navigate(`${location.pathname}?${params}`, {
        replace: true,
        preventScrollReset: true,
      });
    },
    [images, location.pathname, location.search, navigate],
  );

  useEffect(() => {
    if (index === -1) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      }
    }
    // Capture, not bubble: `Dialog.Popup` stops propagation of the arrow keys
    // so they cannot leak out of a popup into whatever is behind it. Here the
    // dialog *is* what they steer, and this listener is on the window, so it
    // only ever sees them on the way down. Moving it onto the popup would work
    // too while focus stays trapped inside; capturing keeps it independent of
    // where focus happens to be.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [index, step]);

  return (
    <DialogPrimitive.Root open={image !== null} onOpenChange={(open) => !open && close()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="bg-background fixed inset-0 z-50 duration-(--lightbox-duration) ease-(--lightbox-ease) data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup
          // No `zoom-in`: that is a transform on an ancestor of the morphing
          // image, so the browser would capture the image's "after" frame at
          // 95% and snap it to full size when the transition ends. The expand
          // *is* this surface's entrance animation now.
          className="fixed inset-0 z-50 flex outline-none duration-(--lightbox-duration) ease-(--lightbox-ease) data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        >
          <DialogPrimitive.Title className="sr-only">
            {image?.title || (image?.kind === "video" ? "Video" : "Image")}
          </DialogPrimitive.Title>

          {image && (
            <div className="relative flex min-h-0 flex-1">
              <div className="flex min-w-0 flex-1 flex-col">
                <LightboxBody
                  images={images}
                  index={index}
                  context={context}
                  detailsHref={detailsHref}
                  detailsOpen={panel !== undefined && panel !== null}
                  onStep={step}
                  onClose={close}
                />
              </div>

              {/* Beside the Image from `sm` up, over it below that — a phone has
                  no room for both, so there the panel shows its own preview. */}
              {panel && (
                <aside
                  aria-label="Image details"
                  className="bg-popover text-popover-foreground absolute inset-0 z-10 overflow-y-auto sm:relative sm:inset-auto sm:z-auto sm:w-105 sm:shrink-0 sm:border-l"
                >
                  {panel}
                </aside>
              )}
            </div>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function LightboxBody({
  images,
  index,
  context,
  detailsHref,
  detailsOpen,
  onStep,
  onClose,
}: {
  images: LightboxImage[];
  index: number;
  context?: string;
  detailsHref?: (id: string) => string;
  detailsOpen: boolean;
  onStep: (delta: number) => void;
  onClose: () => void;
}) {
  // The tile hands the name over for exactly as long as its Image is the one on
  // screen here, so the two are never both wearing it. See `morphFromTile`.
  const morphId = useMorphTarget();
  const image = images[index];
  const total = images.length;

  // Every mounted slot, so the spring can place them without a render.
  const slots = useRef(new Map<number, HTMLElement>());
  const stage = useRef<HTMLDivElement>(null);
  const blur = useRef<SVGFEGaussianBlurElement>(null);
  const settledAt = useStripSpring(index, (at, velocity, frame) => {
    if (stage.current) {
      // Blur first: it reads the stage's width, which is free while nothing
      // has been written yet this frame and a forced layout after.
      blurStrip(stage.current, blur.current, velocity, frame);
      // The spring sets each slot's opacity every frame. A CSS transition on
      // top of that restarts every frame, barely moves, and then catches up
      // all at once when the strip stops, so it is off while the strip moves.
      stage.current.toggleAttribute("data-moving", velocity !== 0);
    }
    placeStrip(slots.current, at, images);
  });

  // The `medium` derivative is capped at 1200px on its longest edge, which is
  // softer than "full size" on a large or retina display. Offering the original
  // as a second candidate lets the browser reach for the real bytes only when
  // the layout actually needs them, rather than pushing a multi-megabyte file at
  // a phone. It is the only way to the original now that nothing links to it.
  //
  // Held back until the strip has come to rest on this Image, though, for two
  // reasons. `original` is a different URL from the `medium` the tile already
  // has in cache, so offering both from the start means this element has
  // nothing to paint until the larger file lands — and that empty frame is
  // exactly what the tile expands into. And walking quickly makes every Image
  // passed over the open one for a moment: upgrading each of them would fetch
  // and decode a run of multi-megabyte files in the middle of the glide, which
  // is precisely the work that makes it drop frames. Starting at the cached
  // `medium` and adding the candidates afterwards gets the same bytes in the
  // end: an `<img>` keeps painting what it has until the replacement has
  // decoded, so the upgrade is invisible whenever it happens.
  const srcSet = settledAt === index ? fullSizeSrcSet(image) : undefined;

  // The neighbour the pointer has moved onto, which lifts a little and leans
  // in towards the open image. Not CSS `:hover`: the strip slides images under a cursor that is standing
  // still, and Chrome only re-checks `:hover` on the next mouse move, so an
  // image would brighten or dim on its own, often after the strip has
  // stopped. Only a real pointer move sets this, and it is tied to the index
  // it was set at, so every step clears it.
  const [pointed, setPointed] = useState<{ index: number; slot: number } | null>(null);
  const pointedSlot = pointed?.index === index ? pointed.slot : null;

  return (
    <>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 py-3 pr-3 pl-4 text-sm sm:py-5 sm:pr-6 sm:pl-9">
        <span className="text-muted-foreground truncate">{context}</span>
        <span className="text-foreground max-w-[40vw] truncate text-center">{image.title}</span>

        <div className="flex items-center justify-end gap-1">
          {total > 1 && (
            <span className="text-muted-foreground mr-3 tabular-nums">
              {index + 1} / {total}
            </span>
          )}
          {/* A toggle, not a way out: the panel opens beside the Image and this
              closes it again. Never open on its own — the viewer is for looking,
              and the Owner asks for the editing surface when they want it. */}
          {detailsHref && (
            <Link
              to={detailsHref(image.id)}
              preventScrollReset
              replace
              aria-pressed={detailsOpen}
              className={cn(CONTROL, "h-9 px-3", detailsOpen && "bg-muted text-foreground")}
            >
              <InfoIcon className="size-4" /> Details
            </Link>
          )}
          <DialogPrimitive.Close className={cn(CONTROL, "bg-muted text-foreground size-9")}>
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </div>
      </div>

      {/* Clicking the surround closes; clicking an image does not, so a
          mis-aimed click on a tall image doesn't dismiss what you came to see.
          The neighbours step instead — they are the only part of them showing.

          `container-type: size` is what lets every slot be laid out in CSS
          alone: a slot's width and offset are fractions of this box, and the
          image's own size, which is not known until it loads, never enters
          into it. */}
      <MotionBlurFilter ref={blur} />

      <div
        ref={stage}
        className="relative min-h-0 flex-1 overflow-hidden [--gap:0.75rem] [--peek:1.5rem] @container-size sm:[--gap:2.5rem] sm:[--peek:3.5rem]"
        onClick={onClose}
      >
        {stripWindow(index, total).map((slot) => {
          const offset = slot - index;
          const slotImage = images[slot];
          const isCurrent = offset === 0;
          const isNeighbour = Math.abs(offset) === 1;

          const ref = (element: HTMLElement | null) => {
            if (!element) return;
            slots.current.set(slot, element);
            return () => {
              slots.current.delete(slot);
            };
          };
          const viewTransitionName = isCurrent && morphId === slotImage.id ? MORPH_NAME : undefined;
          const isPointed = isNeighbour && pointedSlot === slot;
          const assetClassName = cn(
            "size-full rounded-md transition-opacity duration-400 ease-(--lightbox-ease) outline-image in-data-moving:transition-none",
            isPointed ? "opacity-[calc(var(--dim)+0.1)]" : "opacity-(--dim)",
            !isCurrent && (isNeighbour ? "cursor-pointer" : "pointer-events-none"),
          );

          // Only the open slot plays. A video passing by, or waiting at the
          // edge, is its `medium` still — the same frame its poster is.
          const asset =
            isCurrent && slotImage.kind === "video" ? (
              // Plays straight away, muted and looping — a motion reference is
              // something to watch, not to press play on. The sound is still
              // in the file, and the controls can turn it on. The poster is the
              // `medium` the tile already has cached, so the morph has a frame
              // to land on while the clip starts.
              <video
                src={`/img/${slotImage.id}/original`}
                poster={`/img/${slotImage.id}/medium`}
                autoPlay
                muted
                loop
                playsInline
                controls
                aria-label={slotImage.title ?? "Video"}
                data-current=""
                onClick={(event) => event.stopPropagation()}
                style={{ viewTransitionName }}
                className={cn(assetClassName, "bg-black object-contain")}
              />
            ) : (
              <img
                src={`/img/${slotImage.id}/medium`}
                srcSet={isCurrent ? srcSet : undefined}
                sizes="100vw"
                alt={isCurrent ? (slotImage.title ?? "") : ""}
                aria-hidden={isCurrent ? undefined : true}
                data-current={isCurrent ? "" : undefined}
                draggable={isCurrent}
                // Slots mount mid-glide, as the strip brings them within reach.
                // Decoding them off to the side keeps that from holding up a
                // frame; the open one stays synchronous so the morph from the
                // tile never captures it undecoded.
                decoding={isCurrent ? undefined : "async"}
                onClick={(event) => {
                  event.stopPropagation();
                  if (isNeighbour) onStep(offset);
                }}
                onPointerMove={(event) => {
                  if (!isNeighbour || event.pointerType === "touch" || pointedSlot === slot) return;
                  setPointed({ index, slot });
                }}
                onPointerLeave={() => {
                  if (pointedSlot === slot) setPointed(null);
                }}
                style={{ viewTransitionName }}
                className={assetClassName}
              />
            );

          // The shade sits under the dimmed image rather than on it, since
          // `opacity` would fade a background along with the image — and a
          // white image dimmed over a white page is still white.
          //
          // The lean is a `transform`, which the browser applies on top of the
          // `translate` the spring writes — and only `transform` transitions,
          // so the spring still moves the slot without lag. It covers 60% of
          // `--gap`, so a neighbour never reaches even the widest open image;
          // the 1.2 is that doubled, because the slot's half-size scale
          // halves a `transform` on screen.
          return (
            <div
              key={slot}
              ref={ref}
              style={{
                ...slotSize(slotImage),
                viewTransitionName: isNeighbour
                  ? offset < 0
                    ? "lightbox-prev"
                    : "lightbox-next"
                  : undefined,
              }}
              className={cn(
                "absolute top-0 left-0 rounded-md bg-(--lightbox-side-backing)/(--aside) transition-[transform] duration-400 ease-(--lightbox-ease)",
                isPointed &&
                  (offset < 0
                    ? "motion-safe:transform-[translateX(calc(var(--gap)*1.2))]"
                    : "motion-safe:transform-[translateX(calc(var(--gap)*-1.2))]"),
              )}
            >
              {asset}
            </div>
          );
        })}
      </div>

      <div className="grid min-h-16 grid-cols-[1fr_auto_1fr] items-center gap-4 px-3 py-3 sm:px-4 sm:py-5">
        <div>
          {total > 1 && (
            <button
              type="button"
              className={cn(CONTROL, "size-9 disabled:pointer-events-none disabled:opacity-30")}
              disabled={index === 0}
              onClick={() => onStep(-1)}
            >
              <ArrowLeftIcon className="size-4" />
              <span className="sr-only">Previous image</span>
            </button>
          )}
        </div>

        <ImageFacts image={image} />

        <div className="flex justify-end">
          {total > 1 && (
            <button
              type="button"
              className={cn(CONTROL, "size-9 disabled:pointer-events-none disabled:opacity-30")}
              disabled={index === total - 1}
              onClick={() => onStep(1)}
            >
              <ArrowRightIcon className="size-4" />
              <span className="sr-only">Next image</span>
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/** What the file is: `500×500 · PNG · 1.2MB`. */
function ImageFacts({ image }: { image: LightboxImage }) {
  const facts = [
    `${image.width}×${image.height}`,
    image.format.toUpperCase(),
    image.durationMs !== null ? formatDuration(image.durationMs) : null,
    formatBytes(image.byteSize).replace(" ", ""),
  ].filter((fact) => fact !== null);

  return (
    <p className="text-muted-foreground flex items-center gap-2 font-mono text-xs uppercase">
      {facts.map((fact, i) => (
        <span key={i} className="flex shrink-0 items-center gap-2 whitespace-nowrap">
          {i > 0 && <span aria-hidden>·</span>}
          {fact}
        </span>
      ))}
    </p>
  );
}
