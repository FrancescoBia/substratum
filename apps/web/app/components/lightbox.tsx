import { ChevronLeft, ChevronRight, ExternalLink, Info, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
  type ShouldRevalidateFunctionArgs,
} from "react-router";
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
}: {
  images: LightboxImage[];
  /** When set, a "Details" control appears — the Owner's way back to the panel. */
  detailsHref?: (id: string) => string;
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
      navigate(lightboxHref(location.search, location.pathname, next.id), {
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, step]);

  return (
    <DialogPrimitive.Root open={image !== null} onOpenChange={(open) => !open && close()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/85 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // No `zoom-in`: that is a transform on an ancestor of the morphing
          // image, so the browser would capture the image's "after" frame at
          // 95% and snap it to full size when the transition ends. The expand
          // *is* this surface's entrance animation now.
          className="fixed inset-0 z-50 flex flex-col outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        >
          <DialogPrimitive.Title className="sr-only">
            {image?.title || "Image"}
          </DialogPrimitive.Title>

          {image && (
            <LightboxBody
              image={image}
              index={index}
              total={images.length}
              detailsHref={detailsHref}
              onStep={step}
              onClose={close}
            />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function LightboxBody({
  image,
  index,
  total,
  detailsHref,
  onStep,
  onClose,
}: {
  image: LightboxImage;
  index: number;
  total: number;
  detailsHref?: (id: string) => string;
  onStep: (delta: number) => void;
  onClose: () => void;
}) {
  // The tile hands the name over for exactly as long as its Image is the one on
  // screen here, so the two are never both wearing it. See `morphFromTile`.
  const morphId = useMorphTarget();

  // The `medium` derivative is capped at 1200px on its longest edge, which is
  // softer than "full size" on a large or retina display. Offering the original
  // as a second candidate lets the browser reach for the real bytes only when
  // the layout actually needs them, rather than pushing a multi-megabyte file at
  // a phone. It is the only way to the original now that nothing links to it.
  //
  // Held back for a frame, though. `original` is a different URL from the
  // `medium` the tile already has in cache, so offering both from the start
  // means this element has nothing to paint until the larger file lands — and
  // that empty frame is exactly what the tile expands into. Starting at the
  // cached `medium` and adding the candidates afterwards gets the same bytes in
  // the end: an `<img>` keeps painting what it has until the replacement has
  // decoded, so the upgrade is invisible whenever it happens.
  const [upgraded, setUpgraded] = useState(false);
  useEffect(() => {
    setUpgraded(false);
    const frame = requestAnimationFrame(() => setUpgraded(true));
    return () => cancelAnimationFrame(frame);
  }, [image.id]);
  const srcSet = upgraded ? fullSizeSrcSet(image) : undefined;

  return (
    <>
      <div className="flex items-center justify-end gap-1 p-3">
        {detailsHref && (
          <Link
            to={detailsHref(image.id)}
            preventScrollReset
            className={`${CONTROL} h-9 px-3 text-sm`}
          >
            <Info className="size-4" /> Details
          </Link>
        )}
        <DialogPrimitive.Close className={`${CONTROL} size-9`}>
          <X className="size-5" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </div>

      {/* Clicking the surround closes; clicking the image itself does not, so a
          mis-aimed click on a tall image doesn't dismiss what you came to see. */}
      <div
        className="flex min-h-0 flex-1 items-center justify-center px-4 sm:px-16"
        onClick={onClose}
      >
        <img
          key={image.id}
          src={`/img/${image.id}/medium`}
          srcSet={srcSet}
          sizes="100vw"
          alt={image.title ?? ""}
          onClick={(event) => event.stopPropagation()}
          style={{ viewTransitionName: morphId === image.id ? MORPH_NAME : undefined }}
          className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
        />
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

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
