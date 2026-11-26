import { cn } from "cn";
import { ArrowLeftIcon, ArrowRightIcon, InfoIcon, XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useCallback, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { DETAIL_PARAM } from "~/components/detail-panel";
import { formatBytes, formatDuration } from "~/lib/media";
import { isTileOnScreen, morphFromTile } from "./morph";
import { LIGHTBOX_PARAM } from "./routing";
import { Strip } from "./strip";

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
  const { index, image, step, close } = useLightboxNavigation(images);

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
                  detailsOpen={panel != null}
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

/**
 * Which Image the URL has open, and the two ways to move from it: `step` along
 * the set with ← and →, and `close` back to the grid.
 */
function useLightboxNavigation(images: LightboxImage[]) {
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

  return { index, image, step, close };
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
  const image = images[index];
  const total = images.length;

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

      <Strip images={images} index={index} onStep={onStep} onClose={onClose} />

      <div className="grid min-h-16 grid-cols-[1fr_auto_1fr] items-center gap-4 px-3 py-3 sm:px-4 sm:py-5">
        <div>
          {total > 1 && <StepButton direction={-1} disabled={index === 0} onStep={onStep} />}
        </div>

        <ImageFacts image={image} />

        <div className="flex justify-end">
          {total > 1 && <StepButton direction={1} disabled={index === total - 1} onStep={onStep} />}
        </div>
      </div>
    </>
  );
}

function StepButton({
  direction,
  disabled,
  onStep,
}: {
  direction: -1 | 1;
  disabled: boolean;
  onStep: (delta: number) => void;
}) {
  const Icon = direction < 0 ? ArrowLeftIcon : ArrowRightIcon;
  return (
    <button
      type="button"
      className={cn(CONTROL, "size-9 disabled:pointer-events-none disabled:opacity-30")}
      disabled={disabled}
      onClick={() => onStep(direction)}
    >
      <Icon className="size-4" />
      <span className="sr-only">{direction < 0 ? "Previous image" : "Next image"}</span>
    </button>
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
