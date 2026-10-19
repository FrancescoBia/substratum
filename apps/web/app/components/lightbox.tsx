import { ChevronLeft, ChevronRight, ExternalLink, Info, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
import { DETAIL_PARAM } from "~/components/detail-panel";
import { fullSizeSrcSet } from "~/lib/image-variants";

/**
 * The search param that holds the Image being viewed full size. Like `?image=`
 * for the detail panel, this keeps the viewer shareable, reload-stable, and
 * closable with the back button — but it is a *separate* param so the two can
 * never fight over the same slot.
 */
export const LIGHTBOX_PARAM = "view";

/**
 * The `view-transition-name` a grid tile and the viewer's image share so the
 * browser animates one into the other, instead of cross-fading the whole page.
 */
const MORPH_NAME = "lightbox-image";

/**
 * Which Image is mid-morph, or `null` for none.
 *
 * A view transition name may only be on one element at a time — two elements
 * wearing it makes the browser skip the transition entirely — so the tile and
 * the viewer hand it back and forth rather than both holding it. The hand-off
 * has to be decided *before* the browser captures the "before" frame, which
 * means inside the click handler and not in an effect, and both ends of it are
 * read by siblings with no state in common. A document can only run one view
 * transition at a time, so one module-level value is the whole store.
 */
let morphTarget: string | null = null;
const morphListeners = new Set<() => void>();

function subscribeMorph(listener: () => void) {
  morphListeners.add(listener);
  return () => {
    morphListeners.delete(listener);
  };
}

function useMorphTarget() {
  return useSyncExternalStore(
    subscribeMorph,
    () => morphTarget,
    // Nothing is morphing on a server render, or on the client's first one.
    () => null,
  );
}

/**
 * Nominates `id` as the next transition's morphing Image. Call it in the same
 * handler that navigates: React flushes this before the router starts the
 * transition, so the tile is already wearing the name when the frame is taken.
 *
 * A reader who asked for less motion gets no nomination and so no morph — the
 * cross-fade the transition falls back to is still fine, an image flying across
 * the page is not.
 */
export function morphFromTile(id: string | null) {
  const next =
    id !== null && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? null : id;
  if (morphTarget === next) return;
  morphTarget = next;
  for (const listener of morphListeners) listener();
}

/**
 * The name each tile's image should carry, if any. The viewer takes the name
 * over for the Image it is showing, so a tile only wears it while its Image is
 * *not* the open one — which is exactly the two frames the morph animates
 * between, and never both at once.
 */
export function useTileMorphName(): (id: string) => string | undefined {
  const morphId = useMorphTarget();
  const [searchParams] = useSearchParams();
  const openId = searchParams.get(LIGHTBOX_PARAM);

  return useCallback(
    (id: string) => (id === morphId && id !== openId ? MORPH_NAME : undefined),
    [morphId, openId],
  );
}

/**
 * Whether the tile for `id` is somewhere the reader can see. After walking the
 * gallery with ← and → the tile you came from can be pages up the page, and an
 * image flying off to somewhere off-screen reads as a glitch rather than as a
 * return — so that case collapses with a plain fade instead.
 */
function isTileOnScreen(id: string) {
  const tile = document.querySelector(`[data-lightbox-tile="${CSS.escape(id)}"]`);
  if (!tile) return false;

  const rect = tile.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight;
}

export type LightboxImage = {
  id: string;
  kind: "image" | "video";
  width: number;
  height: number;
  title: string | null;
  sourcePageUrl: string | null;
};

/**
 * Opening the viewer, and stepping through it, only moves `?view=`. No loader
 * reads that param, so without this every arrow key would re-run the route's
 * queries to render markup that cannot have changed.
 *
 * Deliberately narrow: it bows out for submissions and for any navigation where
 * something other than `?view=` moved, so a revalidation after an edit still
 * goes through.
 */
export function skipLightboxRevalidation({
  currentUrl,
  nextUrl,
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (formMethod) return defaultShouldRevalidate;
  if (currentUrl.pathname !== nextUrl.pathname) return defaultShouldRevalidate;

  const current = new URLSearchParams(currentUrl.search);
  const next = new URLSearchParams(nextUrl.search);
  if (current.get(LIGHTBOX_PARAM) === next.get(LIGHTBOX_PARAM)) return defaultShouldRevalidate;

  current.delete(LIGHTBOX_PARAM);
  next.delete(LIGHTBOX_PARAM);
  current.sort();
  next.sort();
  return current.toString() === next.toString() ? false : defaultShouldRevalidate;
}

/** Builds the link that opens `id` full size, keeping the rest of the query. */
export function lightboxHref(search: string, pathname: string, id: string): string {
  const params = new URLSearchParams(search);
  params.set(LIGHTBOX_PARAM, id);
  return `${pathname}?${params}`;
}

const CONTROL =
  "inline-flex items-center justify-center gap-1.5 rounded-lg text-white/70 outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/70";

/**
 * The full-size viewer: one Image over a dark scrim, above whatever grid opened
 * it. The grid supplies the whole list it is showing, so ← and → walk the same
 * set in the same order the tiles are in.
 */
export function Lightbox({
  images,
  detailsHref,
  panel,
}: {
  images: LightboxImage[];
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

  // Wraps around: at the last image, → returns to the first. Stepping `replace`s
  // rather than pushes, so however far you walk, one Escape or one Back returns
  // to the grid instead of unwinding the whole visit.
  const step = useCallback(
    (delta: number) => {
      if (images.length < 2) return;
      const from = images.findIndex((image) => image.id === intendedId.current);
      if (from === -1) return;

      const next = images[(from + delta + images.length) % images.length];
      intendedId.current = next.id;

      // The panel follows the viewer: if it is open, it has to be open on the
      // Image now on screen, not the one stepped away from.
      const params = new URLSearchParams(location.search);
      params.set(LIGHTBOX_PARAM, next.id);
      if (params.has(DETAIL_PARAM)) params.set(DETAIL_PARAM, next.id);

      navigate(`${location.pathname}?${params}`, {
        replace: true,
        preventScrollReset: true,
        state: { lightboxStep: Math.sign(delta) },
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
        {/* Less black than a scrim usually is, because the blur is doing half
            the work of separating the Image from the page: at full opacity
            there would be nothing behind it left to blur. The blur fades with
            the element — an opacity below 1 blends the filtered backdrop back
            towards the sharp one — so the page softens rather than snapping
            out of focus, and no keyframe is needed to say so. */}
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md duration-(--lightbox-duration) ease-(--lightbox-ease) data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
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
  detailsHref,
  detailsOpen,
  onStep,
  onClose,
}: {
  images: LightboxImage[];
  index: number;
  detailsHref?: (id: string) => string;
  detailsOpen: boolean;
  onStep: (delta: number) => void;
  onClose: () => void;
}) {
  // The tile hands the name over for exactly as long as its Image is the one on
  // screen here, so the two are never both wearing it. See `morphFromTile`.
  const morphId = useMorphTarget();
  const location = useLocation();
  const image = images[index];
  const total = images.length;
  const position = useStripPosition(index, total, location.state);

  // Every mounted slot, so the spring can place them without a render.
  const slots = useRef(new Map<number, HTMLElement>());
  const stage = useRef<HTMLDivElement>(null);
  const blur = useRef<SVGFEGaussianBlurElement>(null);
  const settledAt = useStripSpring(position, (at, velocity, frame) => {
    // Blur first: it reads the stage's width, which is free while nothing
    // has been written yet this frame and a forced layout after.
    blurStrip(stage.current, blur.current, velocity, frame);
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
  const srcSet = settledAt === position ? fullSizeSrcSet(image) : undefined;

  return (
    <>
      <div className="flex items-center justify-end gap-1 p-3">
        {/* A toggle, not a way out: the panel opens beside the Image and this
            closes it again. Never open on its own — the viewer is for looking,
            and the Owner asks for the editing surface when they want it. */}
        {detailsHref && (
          <Link
            to={detailsHref(image.id)}
            preventScrollReset
            replace
            aria-pressed={detailsOpen}
            className={`${CONTROL} h-9 px-3 text-sm ${detailsOpen ? "bg-white/15 text-white" : ""}`}
          >
            <Info className="size-4" /> Details
          </Link>
        )}
        <DialogPrimitive.Close className={`${CONTROL} size-9`}>
          <X className="size-5" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
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
        className="relative min-h-0 flex-1 overflow-hidden [--gap:0.75rem] [--peek:1.5rem] @container-size sm:[--gap:1.5rem] sm:[--peek:3.5rem]"
        onClick={onClose}
      >
        {stripWindow(position, total).map((slot) => {
          const offset = slot - position;
          const slotImage = images[mod(slot, total)];
          const isCurrent = offset === 0;
          const isNeighbour = Math.abs(offset) === 1;

          const ref = (element: HTMLElement | null) => {
            if (!element) return;
            slots.current.set(slot, element);
            return () => {
              slots.current.delete(slot);
            };
          };
          const style = {
            ...slotSize(slotImage),
            viewTransitionName: isCurrent && morphId === slotImage.id ? MORPH_NAME : undefined,
          };
          const className = `absolute top-0 left-0 rounded-lg opacity-(--dim) shadow-2xl ${
            isCurrent ? "" : isNeighbour ? "cursor-pointer hover:opacity-60" : "pointer-events-none"
          }`;

          // Only the open slot plays. A video passing by, or waiting at the
          // edge, is its `medium` still — the same frame its poster is.
          if (isCurrent && slotImage.kind === "video") {
            return (
              // Plays straight away, muted and looping — a motion reference is
              // something to watch, not to press play on. The sound is still
              // in the file, and the controls can turn it on. The poster is the
              // `medium` the tile already has cached, so the morph has a frame
              // to land on while the clip starts.
              <video
                key={slot}
                src={`/img/${slotImage.id}/original`}
                poster={`/img/${slotImage.id}/medium`}
                autoPlay
                muted
                loop
                playsInline
                controls
                aria-label={slotImage.title ?? "Video"}
                data-current=""
                ref={ref}
                onClick={(event) => event.stopPropagation()}
                style={style}
                className={`${className} bg-black object-contain`}
              />
            );
          }

          return (
            <img
              key={slot}
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
              ref={ref}
              onClick={(event) => {
                event.stopPropagation();
                if (isNeighbour) onStep(offset);
              }}
              style={style}
              className={className}
            />
          );
        })}
      </div>

      <div className="flex min-h-14 items-center justify-center gap-4 px-4 py-3 text-xs text-white/60">
        {total > 1 && (
          <button type="button" className={`${CONTROL} size-9`} onClick={() => onStep(-1)}>
            <ChevronLeft className="size-5" />
            <span className="sr-only">Previous image</span>
          </button>
        )}

        <div className="flex min-w-0 items-center gap-3">
          {total > 1 && (
            <span className="tabular-nums">
              {index + 1} / {total}
            </span>
          )}
          {image.sourcePageUrl && (
            <a
              href={image.sourcePageUrl}
              target="_blank"
              rel="noreferrer nofollow"
              className="inline-flex min-w-0 items-center gap-1 truncate hover:text-white hover:underline"
            >
              <span className="truncate">{image.title || hostOf(image.sourcePageUrl)}</span>
              <ExternalLink className="size-3 shrink-0" />
            </a>
          )}
        </div>

        {total > 1 && (
          <button type="button" className={`${CONTROL} size-9`} onClick={() => onStep(1)}>
            <ChevronRight className="size-5" />
            <span className="sr-only">Next image</span>
          </button>
        )}
      </div>
    </>
  );
}

/**
 * The viewer is a strip of images running off both edges: the one being viewed
 * in the middle, a sliver of its neighbours at the edges, and one more on each
 * side just out of sight, so a step always has something to slide in.
 *
 * Slots are numbered along an *unwrapped* strip — `position` keeps counting
 * past the last image rather than wrapping to 0 — and React keys each `<img>`
 * by that number. So stepping keeps every image that is still in the window
 * mounted, and `useStripSpring` slides them along. Wrapping the number instead
 * would make a short gallery's neighbours fly across the screen to the other
 * side, and would not let one Image appear twice, which a gallery of two
 * needs: its one other Image is both the previous and the next.
 *
 * Four either side, though only one shows: the strip can trail `position` by
 * up to `MAX_LAG` while it catches up, and whatever it is passing over still
 * has to be there to be seen.
 */
const STRIP_REACH = 4;

function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

function stripWindow(position: number, total: number): number[] {
  if (total < 2) return [position];
  const slots: number[] = [];
  for (let slot = position - STRIP_REACH; slot <= position + STRIP_REACH; slot++) slots.push(slot);
  return slots;
}

/**
 * Where on the unwrapped strip the open Image sits. It starts at its own index
 * and from then on moves by the shortest way round to wherever `?view=` went,
 * so arrows held down — which can land a few places at once — still slide the
 * right way. A gallery small enough for both ways round to be equally short
 * goes the way the step was aimed, which `step` leaves in the location state.
 */
function useStripPosition(index: number, total: number, locationState: unknown): number {
  const [strip, setStrip] = useState({ index, position: index });
  if (strip.index === index) return strip.position;

  const forward = mod(index - strip.index, total);
  const backward = forward - total;
  const aimedBack =
    typeof locationState === "object" &&
    locationState !== null &&
    "lightboxStep" in locationState &&
    locationState.lightboxStep === -1;
  const shortest =
    forward < -backward || (forward === -backward && !aimedBack) ? forward : backward;

  const position = strip.position + shortest;
  setStrip({ index, position });
  return position;
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
    fittedHeight(images[mod(below, images.length)]),
    fittedHeight(images[mod(below + 1, images.length)]),
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
    element.style.setProperty("--dim", `${1 - 0.65 * aside}`);
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

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
