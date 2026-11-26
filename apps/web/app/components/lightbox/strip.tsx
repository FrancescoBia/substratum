import { cn } from "cn";
import { useRef, useState, type PointerEvent } from "react";
import { fullSizeSrcSet } from "~/lib/image-variants";
import type { LightboxImage } from "./lightbox";
import { blurStrip, MotionBlurFilter } from "./motion-blur";
import { MORPH_NAME, useMorphTarget } from "./morph";
import { placeStrip, slotSize, stripWindow } from "./strip-geometry";
import { useStripSpring } from "./use-strip-spring";

/**
 * The images, laid out as a strip that slides between them. Clicking the
 * surround closes; clicking an image does not, so a mis-aimed click on a tall
 * image doesn't dismiss what you came to see. The neighbours step instead —
 * they are the only part of them showing.
 */
export function Strip({
  images,
  index,
  onStep,
  onClose,
}: {
  images: LightboxImage[];
  index: number;
  onStep: (delta: number) => void;
  onClose: () => void;
}) {
  // The tile hands the name over for exactly as long as its Image is the one on
  // screen here, so the two are never both wearing it. See `morphFromTile`.
  const morphId = useMorphTarget();
  const { slots, register } = useSlotRegistry();
  const { pointedSlot, handlersFor } = usePointedNeighbour(index);

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
  const srcSet = settledAt === index ? fullSizeSrcSet(images[index]) : undefined;

  return (
    <>
      <MotionBlurFilter ref={blur} />

      {/* `container-type: size` is what lets every slot be laid out in CSS
          alone: a slot's width and offset are fractions of this box, and the
          image's own size, which is not known until it loads, never enters
          into it. */}
      <div
        ref={stage}
        className="relative min-h-0 flex-1 overflow-hidden [--gap:0.75rem] [--peek:1.5rem] @container-size sm:[--gap:2.5rem] sm:[--peek:3.5rem]"
        onClick={onClose}
      >
        {stripWindow(index, images.length).map((slot) => {
          const offset = slot - index;
          const image = images[slot];
          return (
            <StripSlot
              key={slot}
              image={image}
              offset={offset}
              slotRef={register(slot)}
              srcSet={offset === 0 ? srcSet : undefined}
              morphing={offset === 0 && morphId === image.id}
              pointed={pointedSlot === slot}
              pointerHandlers={Math.abs(offset) === 1 ? handlersFor(slot) : undefined}
              onStep={onStep}
            />
          );
        })}
      </div>
    </>
  );
}

/** The names the neighbours slide in and out under, in `app.css`. */
const NEIGHBOUR_TRANSITION_NAME: Partial<Record<number, string>> = {
  [-1]: "lightbox-prev",
  1: "lightbox-next",
};

function StripSlot({
  image,
  offset,
  slotRef,
  srcSet,
  morphing,
  pointed,
  pointerHandlers,
  onStep,
}: {
  image: LightboxImage;
  /** Whole slots from the open image: 0 is the open image, ±1 its neighbours. */
  offset: number;
  slotRef: (element: HTMLElement | null) => (() => void) | undefined;
  srcSet: string | undefined;
  morphing: boolean;
  pointed: boolean;
  pointerHandlers: PointerHandlers | undefined;
  onStep: (delta: number) => void;
}) {
  const isCurrent = offset === 0;
  const isNeighbour = Math.abs(offset) === 1;
  const viewTransitionName = morphing ? MORPH_NAME : undefined;
  const assetClassName = cn(
    "size-full rounded-md opacity-(--dim) transition-opacity duration-(--lightbox-hover-duration) ease-(--lightbox-ease) outline-image in-data-moving:transition-none",
    !isCurrent && (isNeighbour ? "cursor-pointer" : "pointer-events-none"),
  );

  // Only the open slot plays. A video passing by, or waiting at the edge, is
  // its `medium` still — the same frame its poster is.
  const asset =
    isCurrent && image.kind === "video" ? (
      // Plays straight away, muted and looping — a motion reference is
      // something to watch, not to press play on. The sound is still in the
      // file, and the controls can turn it on. The poster is the `medium` the
      // tile already has cached, so the morph has a frame to land on while the
      // clip starts.
      <video
        src={`/img/${image.id}/original`}
        poster={`/img/${image.id}/medium`}
        autoPlay
        muted
        loop
        playsInline
        controls
        aria-label={image.title ?? "Video"}
        data-current=""
        onClick={(event) => event.stopPropagation()}
        style={{ viewTransitionName }}
        className={cn(assetClassName, "bg-black object-contain")}
      />
    ) : (
      <img
        src={`/img/${image.id}/medium`}
        srcSet={srcSet}
        sizes="100vw"
        alt={isCurrent ? (image.title ?? "") : ""}
        aria-hidden={isCurrent ? undefined : true}
        data-current={isCurrent ? "" : undefined}
        draggable={isCurrent}
        // Slots mount mid-glide, as the strip brings them within reach.
        // Decoding them off to the side keeps that from holding up a frame; the
        // open one stays synchronous so the morph from the tile never captures
        // it undecoded.
        decoding={isCurrent ? undefined : "async"}
        onClick={(event) => {
          event.stopPropagation();
          if (isNeighbour) onStep(offset);
        }}
        {...pointerHandlers}
        style={{ viewTransitionName }}
        className={assetClassName}
      />
    );

  return (
    <div
      ref={slotRef}
      data-pointed={pointed || undefined}
      style={{ ...slotSize(image), viewTransitionName: NEIGHBOUR_TRANSITION_NAME[offset] }}
      className="lightbox-slot absolute top-0 left-0 rounded-md"
    >
      {asset}
    </div>
  );
}

/**
 * Every mounted slot, so the spring can place them without a render. `register`
 * gives each slot the ref callback that puts it in, and takes it out again.
 */
function useSlotRegistry() {
  const slots = useRef(new Map<number, HTMLElement>());
  const register = (slot: number) => (element: HTMLElement | null) => {
    if (!element) return;
    slots.current.set(slot, element);
    return () => {
      slots.current.delete(slot);
    };
  };
  return { slots, register };
}

type PointerHandlers = {
  onPointerMove: (event: PointerEvent) => void;
  onPointerLeave: () => void;
};

/**
 * The neighbour the pointer has moved onto, which lifts a little and leans in
 * towards the open image. Not CSS `:hover`: the strip slides images under a
 * cursor that is standing still, and Chrome only re-checks `:hover` on the next
 * mouse move, so an image would brighten or dim on its own, often after the
 * strip has stopped. Only a real pointer move sets this, and it is tied to the
 * index it was set at, so every step clears it.
 */
function usePointedNeighbour(index: number) {
  const [pointed, setPointed] = useState<{ index: number; slot: number } | null>(null);
  const pointedSlot = pointed?.index === index ? pointed.slot : null;

  const handlersFor = (slot: number): PointerHandlers => ({
    onPointerMove: (event) => {
      if (event.pointerType === "touch" || pointedSlot === slot) return;
      setPointed({ index, slot });
    },
    onPointerLeave: () => {
      if (pointedSlot === slot) setPointed(null);
    },
  });

  return { pointedSlot, handlersFor };
}
