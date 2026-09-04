import { ChevronLeft, ChevronRight, ExternalLink, Info, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useCallback, useEffect, useRef } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
  type ShouldRevalidateFunctionArgs,
} from "react-router";

/**
 * The search param that holds the Image being viewed full size. Like `?image=`
 * for the detail panel, this keeps the viewer shareable, reload-stable, and
 * closable with the back button — but it is a *separate* param so the two can
 * never fight over the same slot.
 */
export const LIGHTBOX_PARAM = "view";

/** The longest edge `sharp` derives the `medium` variant at, in `ingest.server.ts`. */
const MEDIUM_EDGE = 1200;

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
    const params = new URLSearchParams(location.search);
    params.delete(LIGHTBOX_PARAM);
    const query = params.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ""}`, { preventScrollReset: true });
  }, [location.pathname, location.search, navigate]);

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
          className="fixed inset-0 z-50 flex flex-col outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0"
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
  // The `medium` derivative is capped at 1200px on its longest edge, which is
  // softer than "full size" on a large or retina display. Offering the original
  // as a second candidate lets the browser reach for the real bytes only when
  // the layout actually needs them, rather than pushing a multi-megabyte file at
  // a phone. It is the only way to the original now that nothing links to it.
  const mediumWidth = mediumWidthOf(image.width, image.height);
  const srcSet =
    image.width > mediumWidth
      ? `/img/${image.id}/medium ${mediumWidth}w, /img/${image.id}/original ${image.width}w`
      : undefined;

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

/** What `sharp`'s `fit: "inside"` resize leaves the `medium` variant's width at. */
function mediumWidthOf(width: number, height: number): number {
  const longest = Math.max(width, height);
  return longest <= MEDIUM_EDGE ? width : Math.round((width * MEDIUM_EDGE) / longest);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
