import { cn } from "cn";
import { ArrowLeftIcon, ArrowRightIcon, InfoIcon, XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { DETAIL_PARAM } from "~/components/detail-panel";
import { fullSizeSrcSet } from "~/lib/image-variants";
import { formatBytes, formatDuration } from "~/lib/media";
import { isTileOnScreen, MORPH_NAME, morphFromTile, useMorphTarget } from "./morph";
import { LIGHTBOX_PARAM } from "./routing";

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
    // Blur first: it reads the stage's width, which is free while nothing
    // has been written yet this frame and a forced layout after.
    blurStrip(stage.current, blur.current, velocity, frame);
    // The spring sets each slot's opacity every frame. A CSS transition on top
    // of that restarts every frame, barely moves, and then catches up all at
    // once when the strip stops, so it is off while the strip moves.
    stage.current?.toggleAttribute("data-moving", velocity !== 0);
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
      {/* The motion blur `blurStrip` turns on while the strip moves fast.
          Horizontal only — a CSS `blur()` goes every way and reads as out of
          focus rather than as speed — and kept inside the stage's own box. */}
      <svg aria-hidden className="pointer-events-none absolute size-0">
        <filter
          id={MOTION_BLUR_FILTER}
          x="0"
          y="0"
          width="1"
          height="1"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur ref={blur} stdDeviation="0 0" />
        </filter>
      </svg>

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

/**
 * The viewer is a strip of images: the one being viewed in the middle, a sliver
 * of its neighbours at the edges, and more beyond them just out of sight, so a
 * step always has something to slide in. The first and last Images simply have
 * nothing on their outer side.
 *
 * React keys each `<img>` by its index, so stepping keeps every image that is
 * still in the window mounted, and `useStripSpring` slides them along.
 *
 * Four either side, though only one shows: the strip can trail the open Image by
 * up to `MAX_LAG` while it catches up, and whatever it is passing over still has
 * to be there to be seen.
 */
const STRIP_REACH = 4;

function stripWindow(index: number, total: number): number[] {
  const slots: number[] = [];
  const last = Math.min(index + STRIP_REACH, total - 1);
  for (let slot = Math.max(index - STRIP_REACH, 0); slot <= last; slot++) slots.push(slot);
  return slots;
}

/**
 * The strip is moved by a spring rather than a CSS transition, for the two
 * things a fixed curve gets wrong when stepping:
 *
 * - It answers at once. A spring pulls hardest when it is furthest from where
 *   it is going, so the strip is already moving on the frame after the key,
 *   and the resistance is all at the far end, where it settles into place.
 * - It keeps its speed when the target moves. A transition restarted from
 *   wherever it had got to starts again from rest, so quick steps stutter —
 *   lurch, brake, lurch. A spring just has somewhere new to go, so a run of
 *   steps reads as one glide that slows down once the steps stop.
 *
 * Critically damped, so it never overshoots: ω = √180 ≈ 13.4/s puts a step
 * half way there in ~125ms and within 1% of it in ~500ms.
 */
const SPRING_STIFFNESS = 180;
const SPRING_DAMPING = 2 * Math.sqrt(SPRING_STIFFNESS);

/**
 * How far the strip may trail its target, in slots. A spring following steady
 * steps trails them by 2/ω slots per step-per-second — about 1.6 slots for
 * someone tapping eleven times a second — so this leaves room for quick
 * tapping to glide. Arrows held down repeat faster than any spring worth
 * looking at can follow; past this the strip is dragged along rather than
 * left to fall further and further behind.
 */
const MAX_LAG = 2.5;

/**
 * Drives the strip's position towards `target` and calls `paint` with it on
 * every frame. Painting happens outside React — a render per frame for
 * something only styles depend on would be all cost — but also once after
 * every render, so slots that have just mounted are placed before the browser
 * gets to draw them where they are not.
 *
 * `paint` also gets the strip's velocity, in slots per second, and how long
 * the frame being painted took, in seconds — between them, how far it moved.
 *
 * Returns the position the strip last came to rest at, or `null` before it
 * first has: the one moment it is worth starting expensive work. Never sooner
 * than a frame after a render, which is what the opening morph needs.
 */
function useStripSpring(
  target: number,
  paint: (at: number, velocity: number, frame: number) => void,
): number | null {
  const spring = useRef({
    at: target,
    velocity: 0,
    target,
    frame: 0,
    last: 0,
    restFrame: 0,
  });
  const paintRef = useRef(paint);
  const [settledAt, setSettledAt] = useState<number | null>(null);

  useLayoutEffect(() => {
    const state = spring.current;
    paintRef.current = paint;
    state.target = target;

    // A reader who asked for less motion gets the strip where it is going.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      cancelAnimationFrame(state.frame);
      state.frame = 0;
      state.at = target;
      state.velocity = 0;
    }

    state.at = Math.min(Math.max(state.at, target - MAX_LAG), target + MAX_LAG);
    paint(state.at, state.velocity, 1 / 60);
    if (state.frame) return;

    if (state.at === target && state.velocity === 0) {
      if (settledAt !== target && !state.restFrame) {
        state.restFrame = requestAnimationFrame(() => {
          state.restFrame = 0;
          setSettledAt(state.target);
        });
      }
      return;
    }
    cancelAnimationFrame(state.restFrame);
    state.restFrame = 0;

    function tick(now: number) {
      // Capped, so a frame that arrives late — a background tab coming back —
      // finishes the motion instead of jumping past it.
      const frame = Math.min((now - state.last) / 1000, 0.1);
      let remaining = frame;
      state.last = now;

      // Small fixed steps keep the integration stable at any frame rate.
      while (remaining > 0) {
        const dt = Math.min(remaining, 1 / 240);
        const force =
          -SPRING_STIFFNESS * (state.at - state.target) - SPRING_DAMPING * state.velocity;
        state.velocity += force * dt;
        state.at += state.velocity * dt;
        remaining -= dt;
      }

      if (Math.abs(state.at - state.target) < 0.0005 && Math.abs(state.velocity) < 0.005) {
        state.at = state.target;
        state.velocity = 0;
        state.frame = 0;
        setSettledAt(state.target);
      } else {
        state.frame = requestAnimationFrame(tick);
      }
      paintRef.current(state.at, state.velocity, frame);
    }

    state.last = performance.now();
    state.frame = requestAnimationFrame(tick);
  });

  // Zeroed as well as cancelled: the handles double as "already scheduled", and
  // a remount — StrictMode does one on purpose — would otherwise wait forever
  // for frames that were cancelled here.
  useEffect(() => {
    const state = spring.current;
    return () => {
      cancelAnimationFrame(state.frame);
      cancelAnimationFrame(state.restFrame);
      state.frame = 0;
      state.restFrame = 0;
    };
  }, []);

  return settledAt;
}

/** The widest any image may be: room left for both neighbours' slivers. */
const MAX_WIDTH = "(100cqw - 2 * (var(--peek) + var(--gap)))";

/**
 * Every image is fitted to the same box — as tall as the stage, and no wider
 * than `MAX_WIDTH` — so its size is known from its dimensions before a byte of
 * it has loaded. All of it is in terms of the stage (`cqw`, `cqh`), `--peek`
 * (how much of a neighbour shows) and `--gap` (the space between two images).
 */
function slotSize(image: LightboxImage): CSSProperties {
  return {
    width: `min(calc${MAX_WIDTH}, calc(100cqh * ${image.width} / ${image.height}))`,
    aspectRatio: `${image.width} / ${image.height}`,
  };
}

function fittedHeight(image: LightboxImage): string {
  return `min(${MAX_WIDTH} * ${image.height} / ${image.width}, 100cqh)`;
}

/**
 * Where an image's left edge sits `offset` whole slots from the middle. The
 * neighbours hang off the edges of the stage by their inner edge rather than
 * off the open image, so the sliver is the same width whatever shape the
 * image in the middle is. Everything further out sits one widest-possible
 * image beyond the slot before it, out of sight.
 */
function slotX(offset: number): string {
  if (offset === 0) return "calc(50cqw - 50%)";
  if (offset === -1) return "calc(var(--peek) - 100%)";
  if (offset === 1) return "calc(100cqw - var(--peek))";

  const beyond = `${Math.abs(offset) - 2} * (${MAX_WIDTH} + var(--gap))`;
  return offset < 0
    ? `calc(var(--peek) - var(--gap) - ${MAX_WIDTH} - 100% - ${beyond})`
    : `calc(100cqw - var(--peek) + var(--gap) + ${MAX_WIDTH} + ${beyond})`;
}

function mix(from: string, to: string, amount: number): string {
  if (amount === 0) return from;
  return `calc(${from} * ${1 - amount} + ${to} * ${amount})`;
}

/** How much of an off-centre image the page shows through. */
const SIDE_DIM = 0.3;

/**
 * Places every slot for the strip being at `at`, which is fractional while it
 * moves: each image is a straight-line blend of the two whole slots it is
 * between.
 *
 * Off-centre images are shown at half size and dimmed, and stand on the open
 * image's bottom edge, shrunk towards their inner bottom corner — so the
 * sliver at the edge stays the same width, and a neighbour stepped to grows
 * up and out of the row into place. The open image is centred, so its bottom
 * edge is a pure function of its dimensions too; between two images it is a
 * blend of both, and the row rides it.
 *
 * Neighbours never collide. Two images a slot apart are blended by the same
 * amount between positions that are at least a gap apart at both ends, and a
 * blend of two such pairs is a gap apart too. Scaling cannot break that: the
 * origin is always inside the box, so a scaled image never leaves the space
 * its full-size box would take.
 */
function placeStrip(slots: Map<number, HTMLElement>, at: number, images: LightboxImage[]) {
  const below = Math.floor(at);
  const between = at - below;
  const openHeight = mix(
    fittedHeight(images[Math.max(below, 0)]),
    fittedHeight(images[Math.min(below + 1, images.length - 1)]),
    between,
  );

  for (const [slot, element] of slots) {
    const offset = slot - at;
    const whole = Math.floor(offset);
    const x = mix(slotX(whole), slotX(whole + 1), offset - whole);
    // 0 for the open image, 1 for a neighbour and anything further out.
    const aside = Math.min(Math.abs(offset), 1);
    const side = Math.max(-1, Math.min(offset, 1));

    element.style.translate = `${x} calc(50cqh + ${openHeight} / 2 - 100%)`;
    element.style.scale = `${1 - 0.5 * aside}`;
    element.style.transformOrigin = `${50 - 50 * side}% 100%`;
    element.style.setProperty("--dim", `${1 - SIDE_DIM * aside}`);
    element.style.setProperty("--aside", `${aside * 100}%`);
  }
}

/**
 * EXPERIMENT: motion blur for a fast-moving strip.
 *
 * A screen shows each frame sharp, so something moving a couple of hundred
 * pixels a frame is seen as a row of crisp copies rather than as movement —
 * strobing, which film never shows because the shutter smears it. This puts
 * the smear back: a horizontal blur scaled to how far the strip moved in the
 * frame, as a shutter open for part of it would have recorded.
 *
 * `MOTION_BLUR` is that fraction — 0 turns the whole thing off. Below half a
 * pixel the filter comes off altogether, so it costs nothing at rest and
 * never softens the open image.
 */
const MOTION_BLUR = 0.25;
const MOTION_BLUR_MAX = 8;
const MOTION_BLUR_FILTER = "lightbox-motion-blur";

function blurStrip(
  stage: HTMLElement | null,
  blur: SVGFEGaussianBlurElement | null,
  velocity: number,
  frame: number,
) {
  if (!stage || !blur) return;

  // A slot is about three quarters of the stage wide: less between narrow
  // images, more between wide ones. Close enough for a smear.
  const travel = Math.abs(velocity) * stage.clientWidth * 0.75 * frame;
  const radius = Math.min(travel * MOTION_BLUR, MOTION_BLUR_MAX);

  if (radius < 0.5) {
    stage.style.filter = "";
    return;
  }
  blur.setAttribute("stdDeviation", `${radius.toFixed(1)} 0`);
  stage.style.filter = `url(#${MOTION_BLUR_FILTER})`;
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
